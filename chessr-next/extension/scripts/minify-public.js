/**
 * Post-build: minify pageContext files + obfuscate all JS bundles
 */

import { createHash } from 'crypto';
import { transformSync } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const distDir = join(import.meta.dirname, '..', 'dist');

// 1. Minify pageContext files (strip console + minify)
const pageContextFiles = readdirSync(distDir).filter(
  f => f.endsWith('.js') && f.startsWith('pageContext')
);

for (const file of pageContextFiles) {
  const filePath = join(distDir, file);
  const code = readFileSync(filePath, 'utf8');
  const result = transformSync(code, {
    minify: true,
    legalComments: 'none',
    drop: ['console'],
  });
  writeFileSync(filePath, result.code);
  console.log(`Minified ${file}: ${code.length} → ${result.code.length} bytes`);
}

// 2. Obfuscate main JS bundles
const obfuscateFiles = ['content.js', 'billing.js', 'streamer.js', 'background.js'];

for (const file of obfuscateFiles) {
  const filePath = join(distDir, file);
  let code;
  try { code = readFileSync(filePath, 'utf8'); } catch { continue; }
  if (code.length < 100) continue; // skip stubs

  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 1,
    unicodeEscapeSequence: false,
  });

  writeFileSync(filePath, result.getObfuscatedCode());
  const newSize = result.getObfuscatedCode().length;
  console.log(`Obfuscated ${file}: ${code.length} → ${newSize} bytes`);
}

// 3. Compute manifest hash and update server .env
const manifestPath = join(distDir, 'manifest.json');
const manifestContent = readFileSync(manifestPath);
const manifestHash = createHash('sha256').update(manifestContent).digest('hex');
console.log(`Manifest hash: ${manifestHash}`);

const serverEnvPath = join(import.meta.dirname, '..', '..', 'serveur', '.env');
try {
  let envContent = readFileSync(serverEnvPath, 'utf8');

  // Move current hash to MANIFEST_HASH_PREV before updating
  const currentMatch = envContent.match(/^MANIFEST_HASH=(.+)$/m);
  const currentHash = currentMatch?.[1]?.trim();
  if (currentHash && currentHash !== manifestHash) {
    const prevMatch = envContent.match(/^MANIFEST_HASH_PREV=(.+)$/m);
    const prevHashes = prevMatch?.[1]?.split(',').map(h => h.trim()).filter(Boolean) || [];
    if (!prevHashes.includes(currentHash)) prevHashes.unshift(currentHash);
    // Keep last 5 hashes
    const newPrev = prevHashes.slice(0, 5).join(',');
    if (prevMatch) {
      envContent = envContent.replace(/^MANIFEST_HASH_PREV=.*/m, `MANIFEST_HASH_PREV=${newPrev}`);
    } else {
      envContent += `\nMANIFEST_HASH_PREV=${newPrev}`;
    }
  }

  if (envContent.match(/^MANIFEST_HASH=/m)) {
    envContent = envContent.replace(/^MANIFEST_HASH=.*/m, `MANIFEST_HASH=${manifestHash}`);
  } else {
    envContent += `\nMANIFEST_HASH=${manifestHash}`;
  }
  writeFileSync(serverEnvPath, envContent);
  console.log(`Updated serveur/.env MANIFEST_HASH`);
} catch (e) {
  console.log(`Could not update serveur/.env: ${e.message}`);
}
