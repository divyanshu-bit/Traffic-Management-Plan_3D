/**
 * normalize-models.mjs
 *
 * Normalizes every GLB in /public/models/ so that after Three.js loads it
 * and applies our standard rotation (X += PI/2), the model stands exactly
 * 1.0 metre tall.  The scale factor is baked into the root node's scale.
 *
 * Run once:  node scripts/normalize-models.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'public', 'models');

// Axis that is "up" in world space AFTER we rotate the mesh by Math.PI/2 on X
// in Three.js.  For models exported with Y-up and NO baked rotation, the Y
// axis is tall in model space.  For models that already have a -90° X bake
// (cone, truck) the Z axis is tall in model space → becomes Y after our
// runtime +90° X rotation.
//
// We auto-detect which axis is tallest after accounting for baked rotation.

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

async function run() {
  const files = readdirSync(MODELS_DIR).filter(f => f.endsWith('.glb'));

  for (const file of files) {
    const filePath = join(MODELS_DIR, file);
    const doc = await io.read(filePath);
    const root = doc.getRoot();

    // Gather all POSITION accessor min/max to find AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const mn = pos.getMin([]);
        const mx = pos.getMax([]);
        if (mn[0] < minX) minX = mn[0];
        if (mn[1] < minY) minY = mn[1];
        if (mn[2] < minZ) minZ = mn[2];
        if (mx[0] > maxX) maxX = mx[0];
        if (mx[1] > maxY) maxY = mx[1];
        if (mx[2] > maxZ) maxZ = mx[2];
      }
    }

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;

    // After applying Three.js rotation Math.PI/2 on X:
    //   model Y → world -Z (depth)
    //   model Z → world Y (up)
    //   model X → world X (left-right)
    //
    // However, models with a baked -90° X quaternion [-0.707,0,0,0.707]
    // are ALREADY corrected for Y-up, so after the runtime +90° they'd be
    // +0°. The runtime rotation then makes model-X → world-X,
    // model-Y → world-Y (up), model-Z → world-Z.
    //
    // Simplest reliable heuristic: the tallest dimension = visual height.
    // For a traffic sign, Y=231, X=8, Z=75 → Y is clearly the height.
    // For a cone:  Y=0.33, X=0.65, Z=0.87 → Z is the height (after bake).
    const tallest = Math.max(sizeX, sizeY, sizeZ);
    if (tallest <= 0) {
      console.log(`${file}: no geometry found, skipping.`);
      continue;
    }

    const scale = 1.0 / tallest;
    console.log(`${file}: size [${sizeX.toFixed(3)}, ${sizeY.toFixed(3)}, ${sizeZ.toFixed(3)}] → tallest=${tallest.toFixed(3)} → scale=${scale.toFixed(6)}`);

    // Apply scale to every root-level scene node
    for (const scene of root.listScenes()) {
      for (const node of scene.listChildren()) {
        const existing = node.getScale();
        node.setScale([
          existing[0] * scale,
          existing[1] * scale,
          existing[2] * scale,
        ]);
      }
    }

    await io.write(filePath, doc);
    console.log(`  ✓ Written`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
