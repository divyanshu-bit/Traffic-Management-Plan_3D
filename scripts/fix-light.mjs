/**
 * Run this once to download the missing light.glb:
 *   node scripts/fix-light.mjs
 */
import https from 'https';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dest = join(__dirname, '..', 'public', 'models', 'light.glb');

// Khronos BoxAnimated GLB — valid PBR metallic-roughness, works as lamp stand-in
const url = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BoxAnimated/glTF-Binary/BoxAnimated.glb';

const chunks = [];
https.get(url, res => {
  if (res.statusCode !== 200) { console.error('HTTP', res.statusCode); process.exit(1); }
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (buf.toString('ascii', 0, 4) !== 'glTF') { console.error('Not a GLB'); process.exit(1); }
    writeFileSync(dest, buf);
    console.log(`✓ light.glb saved (${(buf.length/1024).toFixed(1)} KB)`);
  });
}).on('error', e => { console.error(e.message); process.exit(1); });
