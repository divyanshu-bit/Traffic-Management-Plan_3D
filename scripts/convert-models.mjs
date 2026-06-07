import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough } from '@gltf-transform/functions';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const modelsDir = path.resolve(__dirname, '../public/models');

async function convertModels() {
    console.log(`Scanning directory: ${modelsDir}`);
    const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.glb') || f.endsWith('.gltf'));
    
    for (const file of files) {
        const filePath = path.join(modelsDir, file);
        try {
            const document = await io.read(filePath);
            
            // Removed manual extension check, letting metalRough handle it natively

            console.log(`[CONVERTING] ${file}...`);
            await document.transform(metalRough());
            
            // Overwrite the original file
            await io.write(filePath, document);
            console.log(`[SUCCESS] ${file} converted to PBR Metallic-Roughness.`);
        } catch (error) {
            console.error(`[ERROR] Processing ${file}:`, error);
        }
    }
}

convertModels();
