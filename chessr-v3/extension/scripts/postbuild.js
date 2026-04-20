/**
 * Post-build: strip console logs + obfuscate all JS bundles.
 * Called from the wxt `build:done` hook (so it also runs before `wxt zip`).
 */

import { transformSync } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export async function runPostbuild() {
  const outputRoot = join(import.meta.dirname, '..', '.output');
  if (!existsSync(outputRoot)) return;

  const distDirs = readdirSync(outputRoot)
    .filter((d) => d.startsWith('chrome-mv3'))
    .map((d) => join(outputRoot, d));

  for (const distDir of distDirs) {
    const jsFiles = [
      ...readdirSync(distDir).filter((f) => f.endsWith('.js')),
      ...(existsSync(join(distDir, 'content-scripts'))
        ? readdirSync(join(distDir, 'content-scripts'))
            .filter((f) => f.endsWith('.js'))
            .map((f) => `content-scripts/${f}`)
        : []),
      ...(existsSync(join(distDir, 'chunks'))
        ? readdirSync(join(distDir, 'chunks'))
            .filter((f) => f.endsWith('.js'))
            .map((f) => `chunks/${f}`)
        : []),
    ];

    for (const file of jsFiles) {
      const filePath = join(distDir, file);
      let code;
      try {
        code = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (code.length < 100) continue;

      const stripped = transformSync(code, {
        minify: true,
        legalComments: 'none',
        drop: ['console'],
      });

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
      console.log(`${distDir.split('/').pop()}/${file}: ${code.length} → ${finalCode.length} bytes`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPostbuild();
}
