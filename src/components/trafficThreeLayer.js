/**
 * trafficThreeLayer.js — MapLibre GL JS v5 + Three.js r184
 *
 * KEY INSIGHT: map.transform.getMatrixForModel() already handles:
 *   - translate to mercator position
 *   - rotateZ(PI)    → flips so east is +X
 *   - rotateX(PI/2)  → rotates Y-up world to Z-up mercator
 *   - scale([-s, s, s]) → negative X scale (a reflection on X)
 *
 * Because getMatrixForModel bakes in rotateX(PI/2) and a negative-X scale,
 * the scene itself must NOT apply any additional rotateX or Z-mirror.
 * The scene should be left at identity — the model matrix handles everything.
 *
 * For downloaded Sketchfab GLTF models (which are Y-up, +Z-forward):
 *   - They arrive correctly oriented when the scene is at identity
 *   - getMatrixForModel's built-in rotateX(PI/2) + negX-scale converts
 *     Three.js world space to Mercator space automatically
 *
 * Object positions are in metres relative to the scene origin:
 *   +X = east, +Y = up (altitude), +Z = south
 *   (because getMatrixForModel does rotateX(PI/2): Three's +Z becomes Mercator's -Y = south)
 */

import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

export const TRAFFIC_THREE_LAYER_ID = 'marg-rakshak-traffic-assets-3d';

// ─── Model cache ─────────────────────────────────────────────────────────────
const modelCache = new Map();
const loader = new GLTFLoader();

['cone', 'truck', 'sign'].forEach(name => {
  loader.load(
    `/models/${name}.glb`,
    gltf => {
      // Normalise: make sure materials are double-sided so winding order doesn't matter
      gltf.scene.traverse(child => {
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => { m.side = THREE.DoubleSide; });
        }
      });
      modelCache.set(name, gltf.scene);
      if (name === 'sign') modelCache.set('sign-roadwork', gltf.scene);
      console.log(`[3D] model cached: ${name}`);
    },
    undefined,
    err => console.error(`[3D] model load failed: ${name}`, err)
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert Mercator coordinate offset to metres.
 * Returns { dEastMeter, dNorthMeter }.
 * Note: Mercator Y increases downward (0=north pole, 1=south pole),
 * so dNorthMeter is positive when target is SOUTH of origin.
 */
function mercatorOffsetToMeters(originMerc, targetMerc) {
  const metersPerUnit = 1.0 / originMerc.meterInMercatorCoordinateUnits();
  return {
    dEastMeter: (targetMerc.x - originMerc.x) * metersPerUnit,
    dNorthMeter: (targetMerc.y - originMerc.y) * metersPerUnit,
  };
}

function makeFallbackMesh() {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 1.5, 8),
    new THREE.MeshBasicMaterial({ color: 0x00ff44, side: THREE.DoubleSide })
  );
}

// ─── Layer factory ────────────────────────────────────────────────────────────

export function createTrafficAssetsLayer({ map: mapInstance, onDeleteAsset }) {
  let renderer, scene, camera, loaded = false;

  const state = { zones: [], activeZoneId: null };
  const assetObjects = new Map();
  const assetGroup = new THREE.Group();

  // Scene origin in LngLat — kept near the assets to minimise float precision error
  let originLngLat = mapInstance.getCenter();

  // ─── Sync ───────────────────────────────────────────────────────────────────

  function syncAssets() {
    if (!loaded) return;

    assetGroup.clear();
    assetObjects.clear();

    const allAssets = [];
    state.zones.forEach(zone => {
      (zone.placedAssets || []).forEach(asset => allAssets.push(asset));
    });

    if (allAssets.length === 0) {
      mapInstance.triggerRepaint();
      return;
    }

    // Update origin to centroid of all assets
    const avgLng = allAssets.reduce((s, a) => s + a.lng, 0) / allAssets.length;
    const avgLat = allAssets.reduce((s, a) => s + a.lat, 0) / allAssets.length;
    originLngLat = { lng: avgLng, lat: avgLat };

    const originMerc = MercatorCoordinate.fromLngLat(
      [originLngLat.lng, originLngLat.lat], 0
    );

    allAssets.forEach(asset => {
      const cachedModel =
        modelCache.get(asset.type) ||
        modelCache.get((asset.type || '').split('-')[0]);

      // ── Wrapper group for per-asset transforms ─────────────────────────────
      const wrapper = new THREE.Group();
      wrapper.userData = { id: asset.id };

      let mesh;
      if (cachedModel) {
        mesh = cachedModel.clone();
        mesh.traverse(child => {
          if (child.isMesh) child.userData = { id: asset.id };
          child.frustumCulled = false;
        });
      } else {
        mesh = makeFallbackMesh();
        mesh.userData = { id: asset.id };
      }
      mesh.frustumCulled = false;
      wrapper.add(mesh);

      // ── Position in metres relative to origin ──────────────────────────────
      // getMatrixForModel applies rotateX(PI/2) to the scene, which maps:
      //   Three +X → Mercator east  (correct, no change needed)
      //   Three +Y → Mercator up    (altitude)
      //   Three +Z → Mercator south (Mercator Y increases downward)
      // So we pass dEastMeter as X and dNorthMeter as Z (positive = south of origin).
      const assetMerc = MercatorCoordinate.fromLngLat([asset.lng, asset.lat], 0);
      const { dEastMeter, dNorthMeter } = mercatorOffsetToMeters(originMerc, assetMerc);
      wrapper.position.set(dEastMeter, 0, dNorthMeter);

      // ── Bearing / yaw rotation ─────────────────────────────────────────────
      // After the scene-level rotateX(PI/2), Y is the vertical axis (yaw).
      if (asset.rotation !== undefined) {
        wrapper.rotation.y = -asset.rotation * (Math.PI / 180);
      }

      console.log(
        `[3D] "${asset.type}" @ (${asset.lat.toFixed(5)}, ${asset.lng.toFixed(5)})`,
        `→ (${dEastMeter.toFixed(1)}m E, ${dNorthMeter.toFixed(1)}m N)`
      );

      assetGroup.add(wrapper);
      assetObjects.set(asset.id, wrapper);
    });

    mapInstance.triggerRepaint();
  }

  // ─── CustomLayerInterface ─────────────────────────────────────────────────

  return {
    id: TRAFFIC_THREE_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(map, gl) {
      scene = new THREE.Scene();
      // ⚠️  DO NOT rotate or mirror the scene here.
      // getMatrixForModel() already encodes the full axis transform from
      // Three.js world space to MapLibre Mercator clip space. Any additional
      // scene-level rotation duplicates it and causes flipping.
      scene.add(assetGroup);

      // Lighting — needed for MeshStandardMaterial (common in Sketchfab GLTFs)
      scene.add(new THREE.AmbientLight(0xffffff, 2.5));
      const sun = new THREE.DirectionalLight(0xffffff, 3);
      sun.position.set(1, 2, 1).normalize();
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xffffff, 1);
      fill.position.set(-1, 0.5, -1).normalize();
      scene.add(fill);

      camera = new THREE.Camera();
      camera.matrixAutoUpdate = false;

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;

      loaded = true;
      syncAssets();
    },

    render(gl, args) {
      if (!renderer || !scene || !camera) return;

      // VP matrix: projects Mercator [0..1] coords to clip space
      const vp = new THREE.Matrix4().fromArray(
        args.defaultProjectionData.mainMatrix
      );

      // Model matrix: positions + orients the scene origin on the map
      // This handles: translate to mercator pos, rotateZ(PI), rotateX(PI/2),
      // scale([-s, s, s]) — all axis alignment is done here.
      const modelMat = new THREE.Matrix4().fromArray(
        mapInstance.transform.getMatrixForModel(
          [originLngLat.lng, originLngLat.lat],
          0
        )
      );

      // Final MVP = VP × Model
      camera.projectionMatrix = vp.multiply(modelMat);

      renderer.resetState();
      renderer.render(scene, camera);
      mapInstance.triggerRepaint();
    },

    setData(nextData) {
      state.zones = nextData.zones || [];
      state.activeZoneId = nextData.activeZoneId || null;
      syncAssets();
    },

    handleClick(e) {
      if (!scene || !camera) return false;
      const canvas = mapInstance.getCanvas();
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        (e.point.x / rect.width) * 2 - 1,
        -(e.point.y / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        const id =
          hit.object?.userData?.id ??
          hit.object?.parent?.userData?.id ??
          hit.object?.parent?.parent?.userData?.id;
        if (id && onDeleteAsset) { onDeleteAsset(id); return true; }
      }
      return false;
    },

    dispose() {
      renderer?.dispose();
    },
  };
}