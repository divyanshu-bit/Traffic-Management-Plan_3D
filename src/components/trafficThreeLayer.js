import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

/**
 * REBUILD PHASE 1: BULLETPROOF RENDERING CORE
 * Goal: A minimal, reliable Three.js layer for MapLibre GL JS.
 */

const LAYER_ID = 'marg-rakshak-traffic-assets-3d';

// Cache for loaded GLTF models
const modelCache = new Map();

export function createTrafficAssetsLayer({ map: mapInstance, onDeleteAsset }) {
  let renderer, scene, camera, loaded = false;
  const data = { zones: [], activeZoneId: null };
  const assetObjects = new Map();
  const raycaster = new THREE.Raycaster();
  const assetGroup = new THREE.Group();

  // Preload models
  const loader = new GLTFLoader();
  const modelFiles = ['cone', 'truck', 'sign'];
  modelFiles.forEach(name => {
    loader.load(`/models/${name}.glb`, (gltf) => {
      modelCache.set(name, gltf.scene);
      if (name === 'sign') {
        // Alias for the asset type
        modelCache.set('sign-roadwork', gltf.scene);
      }
      if (loaded) syncAssets();
    }, undefined, (error) => {
      console.error(`Failed to load model: ${name}`, error);
    });
  });

  /**
   * Fallback Green Cylinder representing an asset if model isn't loaded yet
   */
  function makeBasicShape() {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00, 
      side: THREE.DoubleSide,
      depthTest: false // Force to front for visibility testing
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }

  /**
   * Synchronize the Three.js scene with the project data.
   */
  function syncAssets() {
    if (!loaded) return;

    // Clear the asset group to keep this rebuild simple, leaving lights intact
    while(assetGroup.children.length > 0) { 
      assetGroup.remove(assetGroup.children[0]); 
    }
    assetObjects.clear();

    // Iterate through all assets in all zones
    data.zones.forEach(zone => {
      (zone.placedAssets || []).forEach(asset => {
        let shape;
        const cachedModel = modelCache.get(asset.type) || modelCache.get(asset.type.split('-')[0]);
        
        if (cachedModel) {
          shape = cachedModel.clone();
          shape.traverse((child) => {
            if (child.isMesh) {
              // Ensure userData is populated for raycasting on children
              child.userData = { id: asset.id };
            }
          });
          // Rotate GLTF to stand upright (Three.js Y-up to MapLibre Z-up)
          shape.rotation.x = Math.PI / 2;
        } else {
          shape = makeBasicShape();
        }

        shape.userData = { id: asset.id };
        
        // Translate real-world Lat/Lng to MapLibre space
        const mercator = MercatorCoordinate.fromLngLat([asset.lng, asset.lat], 2); // 2m height
        
        // Position the shape
        shape.position.set(mercator.x, mercator.y, mercator.z);
        
        // Scale the shape based on Mercator units
        // BOOST SCALE BY 20x FOR DEBUGGING
        const s = mercator.meterInMercatorCoordinateUnits() * 20; 
        shape.scale.set(s, s, s);

        // Apply rotation if available
        if (asset.rotation !== undefined) {
          // Convert bearing to radians. Depending on the model, it might need offset.
          shape.rotation.y = -asset.rotation * (Math.PI / 180);
        }

        shape.frustumCulled = false;
        shape.traverse((child) => {
          if (child.isMesh) child.frustumCulled = false;
        });

        console.log(`[3D LAYER] Placed asset ${asset.type} at ${asset.lat}, ${asset.lng}. Scale: ${s}`);

        assetGroup.add(shape);
        assetObjects.set(asset.id, shape);
      });
    });
    
    mapInstance.triggerRepaint();
  }

  return {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '2d',

    /**
     * MapLibre Hook: Layer is added to the map.
     */
    onAdd: function (map, gl) {
      scene = new THREE.Scene();
      scene.add(assetGroup);
      
      // Add lighting so GLTF models (MeshStandardMaterial) are visible
      const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
      scene.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
      // MapLibre Z is up, Y is south. Position light to shine from top-south
      directionalLight.position.set(0, -100, 200);
      scene.add(directionalLight);

      // Raycaster requires a PerspectiveCamera or OrthographicCamera
      camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 1e6);
      camera.matrixAutoUpdate = false;

      // Link Three.js to the map's WebGL context
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;

      loaded = true;
      syncAssets();
    },

    /**
     * MapLibre Hook: Every frame draw.
     */
    render: function (gl, matrix) {
      if (!renderer || !scene || !camera) return;

      // Canonical MapLibre 5 Matrix Sync
      const m = matrix?.modelViewProjectionMatrix || matrix;
      camera.projectionMatrix.fromArray(m);
      camera.matrixWorldInverse.identity();

      renderer.resetState();
      renderer.render(scene, camera);
      
      // Keep repainting as long as we want to see updates
      mapInstance.triggerRepaint();
    },

    /**
     * Custom Hook: Receive data from React state.
     */
    setData: function (nextData) {
      data.zones = nextData.zones || [];
      data.activeZoneId = nextData.activeZoneId || null;
      syncAssets();
    },

    /**
     * Custom Hook: Handle clicks for raycasting
     */
    handleClick: function(e) {
      if (!scene || !camera) return false;
      
      const mapCanvas = mapInstance.getCanvas();
      const rect = mapCanvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.point.x) / rect.width) * 2 - 1,
        -((e.point.y) / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      if (intersects.length > 0) {
        // Find the first intersected object that has our asset id
        for (let i = 0; i < intersects.length; i++) {
          const hit = intersects[i].object;
          if (hit.userData && hit.userData.id) {
            if (onDeleteAsset) {
              onDeleteAsset(hit.userData.id);
              return true; // Click handled
            }
          }
        }
      }
      return false; // Click not handled
    },

    /**
     * MapLibre Hook: Layer removed.
     */
    dispose: function () {
      renderer?.dispose();
    }
  };
}

export { LAYER_ID as TRAFFIC_THREE_LAYER_ID };
