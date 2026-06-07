#!/usr/bin/env node
/**
 * download-models.mjs
 *
 * Downloads free, licence-free placeholder GLB models into /public/models/.
 * Run once:  node scripts/download-models.mjs
 *
 * These are simple geometric stand-ins so the 3D layer works immediately.
 * Replace them with your real models whenever you have them.
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'public', 'models');

mkdirSync(MODELS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// These are real, small, working GLB files from public CDNs / sample repos.
// All use standard PBR metallic-roughness (no KHR_pbrSpecularGlossiness).
// ---------------------------------------------------------------------------
const MODELS = [
  {
    name: 'cone.glb',
    // Traffic cone — KhronosGroup sample (ConeGeometry, orange PBR)
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Cone/glTF-Binary/Cone.glb',
  },
  {
    name: 'barrier.glb',
    // Box primitive — small water barrier stand-in
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Box/glTF-Binary/Box.glb',
  },
  {
    name: 'truck.glb',
    // Duck (recognisable stand-in until real truck is added)
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb',
  },
  {
    name: 'sign.glb',
    // Flat box — sign stand-in
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Box/glTF-Binary/Box.glb',
  },
  {
    name: 'light.glb',
    // Cylinder — lamp post stand-in
    url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Cylinder/glTF-Binary/Cylinder.glb',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = { chunks: [] };
    const proto = url.startsWith('https') ? https : http;

    const req = proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.on('data', chunk => file.chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(file.chunks);
        // Sanity check: GLB files start with magic bytes 0x46546C67 ("glTF")
        if (buf.length > 4 && buf.toString('ascii', 0, 4) === 'glTF') {
          writeFileSync(dest, buf);
          resolve(buf.length);
        } else {
          reject(new Error(`Downloaded file is not a valid GLB (got: ${buf.toString('utf8', 0, 30)})`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

async function main() {
  console.log(`\nDownloading placeholder GLB models to ${MODELS_DIR}\n`);

  for (const { name, url } of MODELS) {
    const dest = join(MODELS_DIR, name);
    if (existsSync(dest)) {
      console.log(`  ✓ ${name} already exists — skipping`);
      continue;
    }
    process.stdout.write(`  ↓ ${name} … `);
    try {
      const bytes = await download(url, dest);
      console.log(`done (${(bytes / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      console.log(`    → Place any valid .glb file at public/models/${name} manually.`);
    }
  }

  console.log('\nDone. Now run: npm run dev\n');
}

main();
