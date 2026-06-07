/**
 * fix-sign-rotation.mjs
 *
 * The sign.glb has no baked rotation (Y-up, sign face in XY plane).
 * All other models (cone, truck) have a -90° X rotation baked in so they
 * work correctly with our runtime +90° X rotation in Three.js.
 *
 * This script bakes the same -90° X rotation into sign.glb's root node,
 * making it consistent with the rest of the asset pipeline.
 *
 * Run once:  node scripts/fix-sign-rotation.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = join(__dirname, '..', 'public', 'models', 'sign.glb');

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(filePath);
const root = doc.getRoot();

// Bake -90° X quaternion [x, y, z, w] = [-0.7071067811865475, 0, 0, 0.7071067811865476]
// This is identical to what cone.glb and truck.glb have.
const NEG90X = [-0.7071067811865475, 0, 0, 0.7071067811865476];

for (const scene of root.listScenes()) {
  for (const node of scene.listChildren()) {
    const existing = node.getRotation();
    // If there's already a rotation, compose. For sign there isn't, so just set.
    if (existing[0] === 0 && existing[1] === 0 && existing[2] === 0 && existing[3] === 1) {
      node.setRotation(NEG90X);
      console.log(`Set -90° X rotation on node: ${node.getName()}`);
    } else {
      // Compose quaternions: q_result = NEG90X * existing
      const [ax, ay, az, aw] = NEG90X;
      const [bx, by, bz, bw] = existing;
      node.setRotation([
        aw*bx + ax*bw + ay*bz - az*by,
        aw*by - ax*bz + ay*bw + az*bx,
        aw*bz + ax*by - ay*bx + az*bw,
        aw*bw - ax*bx - ay*by - az*bz,
      ]);
      console.log(`Composed rotation on node: ${node.getName()}`);
    }
  }
}

await io.write(filePath, doc);
console.log('✓ sign.glb rotation fixed.');
