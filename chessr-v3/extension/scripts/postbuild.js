/**
 * Post-build: strip console logs + obfuscate all JS bundles
 */

import { transformSync } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const distDir = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

// Collect all JS files to process
const jsFiles = [
  ...readdirSync(distDir).filter(f => f.endsWith('.js')),
  ...readdirSync(join(distDir, 'content-scripts')).filter(f => f.endsWith('.js')).map(f => `content-scripts/${f}`),
  ...readdirSync(join(distDir, 'chunks')).filter(f => f.endsWith('.js')).map(f => `chunks/${f}`),
];

for (const file of jsFiles) {
  const filePath = join(distDir, file);
  let code;
  try { code = readFileSync(filePath, 'utf8'); } catch { continue; }
  if (code.length < 100) continue;

  // 1. Strip console logs
  const stripped = transformSync(code, {
    minify: true,
    legalComments: 'none',
    drop: ['console'],
  });

  // 2. Obfuscate
  const result = JavaScriptObfuscator.obfuscate(stripped.code, {
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

  const finalCode = result.getObfuscatedCode();
  writeFileSync(filePath, finalCode);
  console.log(`${file}: ${code.length} → ${finalCode.length} bytes`);
}
