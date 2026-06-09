/**
 * trafficThreeLayer.js
 *
 * FIXES APPLIED
 * =============
 * FIX-1  renderingMode: '3d' (was '2d' – depth buffer was disabled)
 * FIX-2  renderer.autoClear = false (was true – wiped MapLibre's tiles)
 * FIX-3  renderer.resetState() (resetGLState removed in r152+)
 * FIX-4  KHRMaterialsPbrSpecularGlossiness plugin REMOVED.
 *        Three.js v0.152+ deleted the plugin entirely because Khronos
 *        deprecated the specular-glossiness workflow.  The GLB files
 *        themselves must be converted to metallic-roughness PBR.
 *        Run the companion script  scripts/convert-models.mjs  once to
 *        convert all files in /public/models/.  After conversion the
 *        GLTFLoader works without any plugin.
 *        A graceful fallback (coloured geometry) is still rendered while
 *        an unconverted file throws the "Unknown extension" error, so the
 *        app never hard-crashes.
 * FIX-5  MercatorCoordinate scale applied to every model
 * FIX-6  Camera matrix rebuilt from MapLibre projection every frame
 * FIX-7  Full GPU resource disposal on onRemove()
 * FIX-8  Asset mutations routed through Zustand store (undo/redo support)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import maplibregl from 'maplibre-gl';

export const TRAFFIC_THREE_LAYER_ID = 'traffic-assets-3d';

// ---------------------------------------------------------------------------
// Asset catalogue  – paths resolve from /public/models/
// ---------------------------------------------------------------------------
const ASSET_MODELS = {
  cone: '/models/cone.glb',
  barrier: '/models/barrier.glb',
  truck: '/models/truck.glb',
  light: '/models/light.glb',
};

// Target dimensions in metres for visibility (Exaggerated for CAD clarity)
const ASSET_MAX_DIM_M = {
  cone: 2.0,      // Smallest but visible
  barrier: 3.0,   // Real-world segment length
  boomgate: 9.0,  // INCREASED: 9m arm for truck-scale dominance
  truck: 15.0,    // Largest unit
  sign: 8.5,      // INCREASED: Towering height for visibility
  light: 14.0,    // Tallest unit
  flagger: 4.0,   // Personnel: Exaggerated for visibility
  supervisor: 4.0,
  marshal: 4.0,
  firstaid: 4.5,
};

const SIGN_DIMENSIONS_M = {
  'sign-roadwork': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-merge': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-slow': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-menwork': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-stop': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-speed30': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-speed50': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-nopark': { width: 4.0, height: 4.0, totalHeight: 8.5 },
  'sign-detour': { width: 5.0, height: 2.5, totalHeight: 8.5 },
  'sign-endwork': { width: 5.0, height: 2.5, totalHeight: 8.5 },
};

// Fallback colours shown when a GLB is missing or still has bad extensions.
const FALLBACK_COLORS = {
  cone: 0xff6600,
  barrier: 0xf97316, // Safety Orange
  boomgate: 0x111111, // Sleek Black
  truck: 0x2266cc,
  sign: 0xffffff,
  light: 0x00ff88,
  flagger: 0x39FF14,    // Neon Green
  supervisor: 0x6366f1, // Indigo
  marshal: 0xf43f5e,    // Rose Red
  firstaid: 0xffffff,   // White
};

// Fallback geometry shapes (normalized to 1.0 tallest dimension)
const FALLBACK_SHAPES = {
  cone: () => new THREE.ConeGeometry(0.3, 1, 8),
  barrier: () => new THREE.BoxGeometry(1, 0.4, 0.25),
  truck: () => new THREE.BoxGeometry(0.4, 0.3, 1),
  sign: () => new THREE.BoxGeometry(1, 1, 0.05),
  light: () => new THREE.CylinderGeometry(0.05, 0.05, 1, 8),
  flagger: () => new THREE.CylinderGeometry(0.2, 0.2, 1, 8),   // Slender Humanoid
  supervisor: () => new THREE.CylinderGeometry(0.2, 0.2, 1, 8),
  marshal: () => new THREE.CylinderGeometry(0.2, 0.2, 1, 8),
  firstaid: () => new THREE.BoxGeometry(0.8, 1, 0.8),         // Station/Tent
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Measures an object's bounding box and returns the scale factor needed
 * to make its longest axis match the target size in metres.
 */
function getAutoCalibrationScale(object, targetMetres) {
  // FIX: Prevent scale oscillation by measuring the unscaled geometry
  const originalScale = object.scale.clone();
  object.scale.set(1, 1, 1);
  
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  
  // Restore scale immediately after measurement
  object.scale.copy(originalScale);
  
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim <= 0) return 1;
  return targetMetres / maxDim;
}

function makeFallbackMesh(type) {
  const geometry = (FALLBACK_SHAPES[type] ?? (() => new THREE.BoxGeometry(1, 1, 1)))();
  const material = new THREE.MeshPhongMaterial({
    color: FALLBACK_COLORS[type] ?? 0xff00ff,
    shininess: 60,
  });
  const mesh = new THREE.Mesh(geometry, material);
  
  // Auto-calibrate the fallback too!
  const s = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M[type] || 1);
  mesh.scale.set(s, s, s);
  
  mesh.userData.isFallback = true;
  return mesh;
}

function disposeMaterial(material) {
  if (!material) return;
  Object.values(material).forEach((value) => {
    if (value?.isTexture) value.dispose();
  });
  material.dispose?.();
}

function disposeObject(object) {
  object?.traverse?.(child => {
    child.geometry?.dispose?.();
    (Array.isArray(child.material) ? child.material : [child.material])
      .forEach(disposeMaterial);
  });
}

function cloneAssetObject(source) {
  const clone = source.clone(true);
  clone.traverse(child => {
    if (!child.isMesh) return;
    child.geometry = child.geometry?.clone?.() ?? child.geometry;
    child.material = Array.isArray(child.material)
      ? child.material.map(material => material?.clone?.() ?? material)
      : child.material?.clone?.() ?? child.material;
  });
  return clone;
}

// ---------------------------------------------------------------------------
// Dynamic Canvas Sign Textures
// ---------------------------------------------------------------------------
function createSignTexture(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Fill canvas background with a dark gray color (to act as back of sign/pole metal fallback)
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, 512, 512);

  // Set up common text style
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (type === 'sign-stop') {
    // Red Octagon
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    const radius = 220;
    const cx = 256;
    const cy = 256;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 + Math.PI / 8;
      ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();

    // White border
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // White text
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 110px sans-serif';
    ctx.fillText('STOP', 256, 256);

  } else if (type === 'sign-speed30' || type === 'sign-speed50') {
    const limit = type === 'sign-speed30' ? '30' : '50';
    // White Circle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(256, 256, 220, 0, 2 * Math.PI);
    ctx.fill();

    // Thick Red border
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();

    // Black text
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 160px sans-serif';
    ctx.fillText(limit, 256, 256);

  } else if (type === 'sign-nopark') {
    // White Circle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(256, 256, 220, 0, 2 * Math.PI);
    ctx.fill();

    // Thick Red border
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();

    // Black P
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 180px sans-serif';
    ctx.fillText('P', 236, 256); // slightly offset to left to center with slash

    // Red slash
    ctx.lineWidth = 20;
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(156, 156);
    ctx.lineTo(356, 356);
    ctx.stroke();

  } else {
    // Warning Signs (Orange Diamond) or Detour/End of Work (Rectangle)
    const isRectangle = type === 'sign-detour' || type === 'sign-endwork';
    
    if (isRectangle) {
      // Orange or Green Rectangle
      const isEnd = type === 'sign-endwork';
      ctx.fillStyle = isEnd ? '#10b981' : '#f97316'; // green or orange
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(40, 100, 432, 312, 20);
      } else {
        ctx.rect(40, 100, 432, 312);
      }
      ctx.fill();

      // Border
      ctx.lineWidth = 14;
      ctx.strokeStyle = isEnd ? '#ffffff' : '#0f172a';
      ctx.stroke();

      // Text
      ctx.fillStyle = isEnd ? '#ffffff' : '#0f172a';
      ctx.font = '900 56px sans-serif';
      if (type === 'sign-detour') {
        ctx.fillText('DETOUR', 256, 216);
        // Draw a simple arrow below
        ctx.lineWidth = 12;
        ctx.strokeStyle = '#0f172a';
        ctx.beginPath();
        ctx.moveTo(176, 306);
        ctx.lineTo(336, 306);
        ctx.moveTo(296, 276);
        ctx.lineTo(336, 306);
        ctx.lineTo(296, 336);
        ctx.stroke();
      } else {
        // sign-endwork
        ctx.fillText('END', 256, 216);
        ctx.fillText('ROAD WORK', 256, 296);
      }
    } else {
      // Orange Diamond (Warning)
      ctx.fillStyle = '#f97316'; // orange
      ctx.beginPath();
      const radius = 230;
      ctx.moveTo(256, 256 - radius);
      ctx.lineTo(256 + radius, 256);
      ctx.lineTo(256, 256 + radius);
      ctx.lineTo(256 - radius, 256);
      ctx.closePath();
      ctx.fill();

      // Black border
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();

      // Text
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 50px sans-serif';
      let lines = [];
      if (type === 'sign-roadwork') {
        lines = ['ROAD', 'WORK', 'AHEAD'];
      } else if (type === 'sign-merge') {
        lines = ['LANE', 'MERGE'];
      } else if (type === 'sign-slow') {
        ctx.font = '900 80px sans-serif';
        lines = ['SLOW'];
      } else if (type === 'sign-menwork') {
        lines = ['MEN', 'AT', 'WORK'];
      } else {
        lines = ['SIGNAL'];
      }

      const lineHeight = 55;
      const startY = 256 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => {
        ctx.fillText(line, 256, startY + i * lineHeight);
      });
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// Procedural sign billboard – Volumetric 3D Panel for maximum visibility
// ---------------------------------------------------------------------------
function makeSignBillboard(type) {
  const group = new THREE.Group();
  const { width: panelWidth, height: panelHeight, totalHeight } =
    SIGN_DIMENSIONS_M[type] ?? SIGN_DIMENSIONS_M['sign-roadwork'];
  
  const panelDepth = 0.2; // 20cm thick panel for side-visibility
  const poleHeight = Math.max(0.1, totalHeight - panelHeight);
  const poleRadius = 0.35; // MATCH SCALE: Reinforced pole for jumbo signs

  // 1. The Volumetric Sign Panel
  const panelGeo = new THREE.BoxGeometry(panelWidth, panelHeight, panelDepth);
  
  // Custom materials for each face of the box
  const signTexture = createSignTexture(type);
  const frontMat = new THREE.MeshPhongMaterial({ map: signTexture, shininess: 80 });
  const backMat = new THREE.MeshPhongMaterial({ map: signTexture, shininess: 80 });
  const edgeMat = new THREE.MeshPhongMaterial({ color: '#334155', shininess: 100 }); // Slate edge

  const materials = [
    edgeMat, // Right
    edgeMat, // Left
    edgeMat, // Top
    edgeMat, // Bottom
    frontMat, // Front
    backMat,  // Back
  ];

  const panel = new THREE.Mesh(panelGeo, materials);
  panel.position.y = poleHeight + panelHeight / 2;
  group.add(panel);

  // 2. High-Visibility Pole
  const poleGeo = new THREE.CylinderGeometry(poleRadius, poleRadius, poleHeight, 8);
  const poleMat = new THREE.MeshPhongMaterial({ 
    color: '#94a3b8', 
    specular: '#ffffff',
    shininess: 100 
  });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = poleHeight / 2;
  group.add(pole);

  // 3. Neon Halo (Optional - subtle glow to the edges to make it "pop")
  const haloGeo = new THREE.BoxGeometry(panelWidth + 0.05, panelHeight + 0.05, panelDepth - 0.05);
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3 });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(panel.position);
  group.add(halo);

  group.frustumCulled = false;
  group.userData.isSignBillboard = true;
  return group;
}

// ---------------------------------------------------------------------------
// Procedural Water Barrier – Realistic Jersey profile
// ---------------------------------------------------------------------------
function makeWaterBarrierMesh() {
  const shape = new THREE.Shape();
  // Jersey Barrier Profile (relative coordinates, centered on X)
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, 0.15);
  shape.lineTo(0.35, 0.25);
  shape.lineTo(0.15, 0.9);
  shape.lineTo(0.15, 1.0);
  shape.lineTo(-0.15, 1.0);
  shape.lineTo(-0.15, 0.9);
  shape.lineTo(-0.35, 0.25);
  shape.lineTo(-0.5, 0.15);
  shape.lineTo(-0.5, 0);

  const extrudeSettings = {
    steps: 1,
    depth: 2.5, // 2.5m segment
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelOffset: 0,
    bevelSegments: 3
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.center();
  geometry.rotateX(Math.PI / 2); // Align with XZ plane

  const material = new THREE.MeshStandardMaterial({
    color: '#f97316', // Safety Orange
    roughness: 0.3,
    metalness: 0.1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  
  // Add detail: top fill cap (small cylinder)
  const capGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12);
  const capMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.5 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.52; 
  mesh.add(cap);

  mesh.userData.isProceduralBarrier = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Procedural Boom Gate – Site Access Control (SUPER-SIZED HEAVY DUTY)
// ---------------------------------------------------------------------------
function makeBoomGateMesh() {
  const group = new THREE.Group();

  // 1. Concrete Mounting Pad (Massive foundation)
  const padGeo = new THREE.BoxGeometry(2.0, 0.25, 2.0);
  const padMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.8 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.y = 0.125;
  group.add(pad);

  // 2. Base Cabinet (Commanding Presence - Obsidian Black)
  const baseGeo = new THREE.BoxGeometry(1.4, 2.4, 1.4);
  const baseMat = new THREE.MeshStandardMaterial({ 
    color: '#111111', // Obsidian Black
    roughness: 0.1,
    metalness: 0.8 
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 1.45; // Sitting on pad
  group.add(base);

  // 3. Control Panel Detail (Keypad/Screen)
  const panelGeo = new THREE.BoxGeometry(0.1, 0.7, 0.6);
  const panelMat = new THREE.MeshStandardMaterial({ color: '#1e293b', emissive: '#0ea5e9', emissiveIntensity: 0.6 });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.position.set(0.71, 1.8, 0);
  group.add(panel);

  // 4. Safety Beacon (Industrial Strobe)
  const beaconGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.3, 12);
  const beaconMat = new THREE.MeshStandardMaterial({ 
    color: '#ef4444', 
    emissive: '#ef4444', 
    emissiveIntensity: 3.0,
    transparent: true,
    opacity: 0.9
  });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.y = 2.8;
  group.add(beacon);

  // 5. The Arm (Boom) - JUMBO TRUCK SCALE
  const armLen = 9.0; 
  const armGeo = new THREE.BoxGeometry(armLen, 0.35, 0.6); // Massive beam
  
  // Create SUPER-BOLD striped texture
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ef4444';
  // Extra wide stripes
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(i * 128, 0, 80, 128);
  }
  const stripeTex = new THREE.CanvasTexture(canvas);
  stripeTex.repeat.set(1, 1);
  stripeTex.wrapS = THREE.RepeatWrapping;

  const armMat = new THREE.MeshStandardMaterial({ 
    map: stripeTex,
    roughness: 0.3,
    metalness: 0.1
  });
  const arm = new THREE.Mesh(armGeo, armMat);
  
  // Position arm at pivot point (top of base)
  arm.position.set(armLen/2 - 0.6, 2.0, 0);
  arm.rotation.z = THREE.MathUtils.degToRad(10); // Slightly raised
  group.add(arm);

  // 6. Heavy-Duty Pivot Mechanism (Reinforced)
  const pivotGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 16);
  pivotGeo.rotateX(Math.PI/2);
  const pivot = new THREE.Mesh(pivotGeo, new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.9 }));
  pivot.position.set(0, 2.0, 0);
  group.add(pivot);

  // Pivot Central Bolt
  const boltGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.3, 12);
  boltGeo.rotateX(Math.PI/2);
  const boltMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 1 });
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.position.set(0, 2.0, 0);
  group.add(bolt);

  group.userData.isBoomGate = true;
  return group;
}

// ---------------------------------------------------------------------------
// createTrafficAssetsLayer
// ---------------------------------------------------------------------------
export function createTrafficAssetsLayer({ map, onDeleteAsset }) {
  console.log('%c[OMNI-ARCHITECT] Initializing 3D Layer v2.3 (Boom Gates Active)', 'background: #0ea5e9; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;');
  
  let renderer = null;
  let scene = null;
  let camera = null;
  let meshCache = {};  // type → THREE.Object3D
  let objects = {};   // assetId → { mesh, data }
  let currentData = { zones: [], activeZoneId: null };
  let originLngLat = null;
  let originMercator = null;
  let isExporting = false;

  // ---- GLTFLoader (NO KHR plugin — removed, see FIX-4 note above) ----------
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);

  // Preload all model types
  const modelLoads = {};
  Object.entries(ASSET_MODELS).forEach(([type, url]) => {
    // Skip procedural types
    if (type === 'barrier' || type === 'boomgate') return;

    modelLoads[type] = new Promise((resolve) => {
      loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse(child => {
            if (!child.isMesh) return;
            child.castShadow = false;
            child.receiveShadow = false;
            // Ensure PBR materials have correct colour space
            if (child.material?.map) {
              child.material.map.colorSpace = THREE.SRGBColorSpace;
            }
          });
          meshCache[type] = root;
          console.log(`[3D] Preloaded GLB model "${type}" successfully.`);
          resolve(root);
        },
        undefined,
        (err) => {
          console.warn(
            `[3D] "${url}" failed to load (${err.message}).`,
            err.message.includes('KHR_materials_pbrSpecularGlossiness')
              ? 'Run scripts/convert-models.mjs to convert this file to PBR metallic-roughness.'
              : 'Check that the file exists in /public/models/.'
          );
          meshCache[type] = makeFallbackMesh(type);
          console.log(`[3D] Created fallback mesh for "${type}".`);
          resolve(meshCache[type]);
        }
      );
    });
  });

  // ---- Coordinate helpers --------------------------------------------------

  function ensureOrigin(data = currentData) {
    // FIX: Bulletproof Permanent Anchor
    // Once the origin is set for this session, it NEVER changes.
    // This prevents existing assets from teleporting when new ones are added.
    if (originLngLat && originMercator) return;

    const assets = (data.zones ?? []).flatMap(zone => zone.placedAssets ?? []);
    if (assets.length > 0) {
      // Anchor permanently to the first placed asset
      originLngLat = { lng: assets[0].lng, lat: assets[0].lat };
      console.log('[3D] Origin PERMANENTLY locked to first asset:', originLngLat);
    } else {
      // Fallback: Anchor permanently to the initial map center
      const center = map.getCenter();
      originLngLat = { lng: center.lng, lat: center.lat };
      console.log('[3D] Origin PERMANENTLY locked to map center:', originLngLat);
    }
    originMercator = maplibregl.MercatorCoordinate.fromLngLat([originLngLat.lng, originLngLat.lat], 0);
  }

  function toLocalMeters(lng, lat) {
    if (!originMercator) ensureOrigin();
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    const metersPerMercatorUnit = 1 / originMercator.meterInMercatorCoordinateUnits();
    return {
      x: (mc.x - originMercator.x) * metersPerMercatorUnit,
      y: 0,
      z: (mc.y - originMercator.y) * metersPerMercatorUnit,
    };
  }

  function renderProjectionMatrix(args) {
    if (!originLngLat) ensureOrigin();
    
    // REVERT to extracting the matrix from MapLibre's render args
    const projectionArray =
      Array.isArray(args) || ArrayBuffer.isView(args)
        ? args
        : args?.defaultProjectionData?.mainMatrix ??
          args?.defaultProjectionData?.projectionMatrix ??
          args?.modelViewProjectionMatrix ??
          args?.projectionMatrix;

    if (!projectionArray) {
      console.warn('[3D] renderProjectionMatrix: No projection matrix found in args.');
      return null;
    }

    const projectionMatrix = new THREE.Matrix4().fromArray(projectionArray);
    
    // Bridge the local Three.js coordinate system (metres) to the MapLibre coordinate system
    const modelMatrix = new THREE.Matrix4().fromArray(
      map.transform.getMatrixForModel([originLngLat.lng, originLngLat.lat], 0)
    );
    
    return projectionMatrix.multiply(modelMatrix);
  }

  // ---- Scene helpers -------------------------------------------------------

const TYPE_PRIORITY = { truck: 3, boomgate: 2, barrier: 2, sign: 2, light: 2, cone: 1, supervisor: 1, flagger: 1 };

  function upsertMesh(asset) {
    const { id, type, lng, lat, rotation = 0 } = asset;
    const local = toLocalMeters(lng, lat);
    
    // Z-FIGHTING MITIGATION: Give larger assets a microscopic Y-priority offset
    const priority = TYPE_PRIORITY[type.split('-')[0]] || 0;
    local.y += (priority * 0.01); 

    const visibilityMultiplier = isExporting ? 3.0 : 1.0;

    // FIX-8: If asset exists but type changed, remove old mesh first to force recreation
    if (objects[id] && objects[id].data && objects[id].data.type !== type) {
      removeMesh(id);
    }

    // --- SIGN ASSETS: use procedural billboard ---
    if (type.startsWith('sign')) {
      if (objects[id]) {
        const { mesh } = objects[id];
        mesh.position.set(local.x, local.y, local.z);
        mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
        
        // Dynamic scale update for export
        const currentScale = mesh.scale.x;
        if (Math.abs(currentScale - visibilityMultiplier) > 0.1) {
          mesh.scale.set(visibilityMultiplier, visibilityMultiplier, visibilityMultiplier);
        }

        objects[id].data = asset;
        return;
      }

      const mesh = makeSignBillboard(type);
      mesh.position.set(local.x, local.y, local.z);
      mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
      mesh.scale.set(visibilityMultiplier, visibilityMultiplier, visibilityMultiplier);
      mesh.traverse(child => {
        child.frustumCulled = false;
        child.userData = Object.assign(child.userData || {}, { assetId: id, type });
      });
      mesh.userData = Object.assign(mesh.userData || {}, { assetId: id, type });
      scene.add(mesh);
      objects[id] = { mesh, data: asset };
      return;
    }

    // --- BOOM GATE ASSETS ---
    if (type === 'boomgate') {
      if (objects[id]) {
        const { mesh } = objects[id];
        mesh.position.set(local.x, local.y, local.z);
        mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
        
        const forceS = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M['boomgate']) * visibilityMultiplier;
        mesh.scale.set(forceS, forceS, forceS);

        objects[id].data = asset;
        return;
      }

      const mesh = makeBoomGateMesh();
      mesh.position.set(local.x, local.y, local.z);
      mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
      
      const s = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M['boomgate']) * visibilityMultiplier;
      mesh.scale.set(s, s, s);

      mesh.traverse(child => {
        child.frustumCulled = false;
        child.userData = Object.assign(child.userData || {}, { assetId: id, type });
      });
      mesh.userData = Object.assign(mesh.userData || {}, { assetId: id, type });
      scene.add(mesh);
      objects[id] = { mesh, data: asset };
      return;
    }

    // --- BARRIER ASSETS: use procedural Jersey barrier ---
    if (type === 'barrier') {
      if (objects[id]) {
        const { mesh } = objects[id];
        mesh.position.set(local.x, local.y, local.z);
        mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
        
        const forceS = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M['barrier']) * visibilityMultiplier;
        mesh.scale.set(forceS, forceS, forceS);

        objects[id].data = asset;
        return;
      }

      const mesh = makeWaterBarrierMesh();
      mesh.position.set(local.x, local.y, local.z);
      mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
      
      const s = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M['barrier']) * visibilityMultiplier;
      mesh.scale.set(s, s, s);

      mesh.traverse(child => {
        child.frustumCulled = false;
        child.userData = Object.assign(child.userData || {}, { assetId: id, type });
      });
      mesh.userData = Object.assign(mesh.userData || {}, { assetId: id, type });
      scene.add(mesh);
      objects[id] = { mesh, data: asset };
      return;
    }

    // --- NON-PROCEDURAL ASSETS: use GLB model from meshCache ---
    const modelType = type;
    const isModelLoaded = !!meshCache[modelType];
    const meshSource = meshCache[modelType] || makeFallbackMesh(modelType);

    if (objects[id]) {
      const { mesh } = objects[id];
      // FIX: If existing mesh is a fallback but real model is now available, replace it
      if (mesh.userData.isFallback && isModelLoaded) {
        removeMesh(id);
        // continue to create new mesh below
      } else {
        mesh.position.set(local.x, local.y, local.z);
        mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
        
        // FORCE RE-CALIBRATE: Ensure even old assets use new scaling + Jumbo Multiplier
        const forceS = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M[modelType] || 1) * visibilityMultiplier;
        mesh.scale.set(forceS, forceS, forceS);
        
        objects[id].data = asset;
        return;
      }
    }

    const mesh = cloneAssetObject(meshSource);
    mesh.position.set(local.x, local.y, local.z);
    
    // INITIAL CALIBRATE + Jumbo Multiplier
    const s = getAutoCalibrationScale(mesh, ASSET_MAX_DIM_M[modelType] || 1) * visibilityMultiplier;
    mesh.scale.set(s, s, s);
    
    mesh.rotation.set(0, THREE.MathUtils.degToRad(-rotation), 0);
    mesh.frustumCulled = false;
    mesh.traverse(child => {
      child.frustumCulled = false;
      child.userData = Object.assign(child.userData || {}, { assetId: id, type });
    });
    mesh.userData = Object.assign(mesh.userData || {}, { assetId: id, type });
    scene.add(mesh);
    objects[id] = { mesh, data: asset };
  }

  function removeMesh(id) {
    if (!objects[id]) return;
    scene.remove(objects[id].mesh);
    disposeObject(objects[id].mesh);
    delete objects[id];
  }

  function syncScene(data) {
    console.log(`[3D] syncScene called. Zones count:`, (data.zones ?? []).length);
    isExporting = !!data.isExporting;
    ensureOrigin(data);
    const liveIds = new Set();
    (data.zones ?? []).forEach(zone => {
      (zone.placedAssets ?? []).forEach(asset => {
        liveIds.add(asset.id);
        upsertMesh(asset);
      });
    });
    Object.keys(objects).forEach(id => {
      if (!liveIds.has(id)) {
        removeMesh(id);
      }
    });
  }


  // ---- Raycasting ----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndcMouse = new THREE.Vector2();

  function handleClick(e) {
    if (!renderer || !camera || !map) return false;
    
    let assetId = null;

    // --- 1. PRIMARY: 3D Raycasting ---
    try {
      if (!originLngLat) ensureOrigin();
      // Rebuild MVP matrix for accuracy
      const projMatrix = new THREE.Matrix4().fromArray(map.transform.projectionMatrix);
      const modelMatrix = new THREE.Matrix4().fromArray(
        map.transform.getMatrixForModel([originLngLat.lng, originLngLat.lat], 0)
      );
      camera.projectionMatrix.copy(projMatrix.multiply(modelMatrix));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      const canvas = map.getCanvas();
      ndcMouse.x = (e.point.x / canvas.clientWidth) * 2 - 1;
      ndcMouse.y = -(e.point.y / canvas.clientHeight) * 2 + 1;

      raycaster.setFromCamera(ndcMouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      
      if (hits.length > 0) {
        for (const hit of hits) {
          let obj = hit.object;
          while (obj) {
            if (obj.userData?.assetId) {
              assetId = obj.userData.assetId;
              break;
            }
            obj = obj.parent;
          }
          if (assetId) break;
        }
      }
    } catch (err) {
      console.warn('[3D] Raycast failed, using fallback:', err);
    }

    // --- 2. SECONDARY: Distance-based Fallback (Bulletproof) ---
    if (!assetId) {
      const clickLng = e.lngLat.lng;
      const clickLat = e.lngLat.lat;
      let closestId = null;
      let minDistance = 5.0; // 5 metre radius for deletion "hitbox"

      (currentData.zones || []).forEach(zone => {
        (zone.placedAssets || []).forEach(asset => {
          // Fast check: roughly 10m box
          const dLng = Math.abs(asset.lng - clickLng);
          const dLat = Math.abs(asset.lat - clickLat);
          if (dLng < 0.0001 && dLat < 0.0001) {
            // Simple Euclidean distance in metres (approximate but effective)
            const dx = (asset.lng - clickLng) * 111320 * Math.cos(clickLat * Math.PI / 180);
            const dy = (asset.lat - clickLat) * 111320;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < minDistance) {
              minDistance = dist;
              closestId = asset.id;
            }
          }
        });
      });
      if (closestId) {
        assetId = closestId;
        console.log(`[3D] Asset identified via Distance Fallback (${minDistance.toFixed(1)}m): ${assetId}`);
      }
    }

    if (assetId) {
      console.log(`%c[3D] DELETE ASSET: ${assetId}`, 'color: #ef4444; font-weight: bold;');
      onDeleteAsset?.(assetId);
      return true;
    }
    
    return false;
  }

  // ---- MapLibre custom layer -----------------------------------------------
  const layer = {
    id: TRAFFIC_THREE_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(mapRef, gl) {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera();

      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(0.5, 0.707, 0.5).normalize(); // Points DOWN towards origin
      scene.add(sun);

      renderer = new THREE.WebGLRenderer({
        canvas: mapRef.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;                // FIX-2
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      ensureOrigin(currentData);

      // FIX: After ALL models load, re-sync with whatever data is current
      // at that point — not just what was passed at layer init time.
      // This fixes assets not showing on landing page when zones already
      // have placedAssets before the layer mounts.
      Promise.all(Object.values(modelLoads)).then(() => {
        console.log('[3D] All models loaded. Syncing scene with current data...');
        syncScene(currentData);
        mapRef.triggerRepaint();
        // Trigger a second repaint 500ms later to catch any timing edge cases
        setTimeout(() => {
          if (scene) { syncScene(currentData); mapRef.triggerRepaint(); }
        }, 500);
      });
    },

    render(gl, args) {
      if (!renderer || !scene || !camera) return;

      // Premium Polish: Subtle Halo Pulsing
      const time = Date.now() * 0.002;
      const pulse = 0.3 + Math.sin(time) * 0.2;
      scene.traverse(obj => {
        if (obj.userData?.isSignBillboard) {
          const halo = obj.children.find(c => c.material?.transparent);
          if (halo) halo.material.opacity = pulse;
        }
      });

      const activeObjectsCount = Object.keys(objects).length;
      if (activeObjectsCount > 0 && Math.random() < 0.01) {
        console.log(`[3D] render loop running. Active assets: ${activeObjectsCount}, scene children count: ${scene.children.length}`);
      }

      const projectionMatrix = renderProjectionMatrix(args);
      if (!projectionMatrix) return;
      camera.projectionMatrix = projectionMatrix;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      renderer.resetState();       // FIX-3

      // Ensure depth writing is active and clear the depth buffer
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      renderer.render(scene, camera);
    },

    onRemove() {
      // FIX-7: full GPU cleanup
      Object.keys(objects).forEach(id => removeMesh(id));
      Object.values(meshCache).forEach(disposeObject);
      disposeObject(scene);
      dracoLoader.dispose();
      renderer?.dispose();
      renderer = null; scene = null; camera = null;
      meshCache = {}; objects = {}; originLngLat = null; originMercator = null;
    },

    setData(data) {
      currentData = data;
      if (!scene) return; // layer not mounted yet — currentData will be used when onAdd fires

      const allLoaded = Object.values(meshCache).length === Object.keys(ASSET_MODELS).length;
      if (allLoaded) {
        // Models ready — sync immediately
        syncScene(data);
        map.triggerRepaint();
      } else {
        // Models still loading — wait for them then sync with latest data
        Promise.all(Object.values(modelLoads)).then(() => {
          syncScene(currentData); // use currentData (latest) not stale closure
          map.triggerRepaint();
        });
      }
    },

    handleClick,
    dispose() { layer.onRemove(); },
  };

  return layer;
}