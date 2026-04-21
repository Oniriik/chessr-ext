/**
 * Post-build: strip console logs + obfuscate all JS bundles.
 * Called from the wxt `build:done` hook (so it also runs before `wxt zip`).
 */

import { transformSync } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

export async function runPostbuild() {
  const outputRoot = join(import.meta.dirname, '..', '.output');
  if (!existsSync(outputRoot)) return;

  // Only process the directory that was just (re-)built. Without this the
  // hook also re-obfuscates stale outputs from previous `wxt build` runs,
  // which can crash the obfuscator on huge accumulated bundles.
  // Heuristic: pick the chrome-mv3* dir whose mtime is the freshest, but
  // always skip chrome-mv3-dev so console.log / debug logs survive dev runs.
  const candidates = readdirSync(outputRoot)
    .filter((d) => d.startsWith('chrome-mv3') && !d.endsWith('-dev'))
    .map((d) => {
      const p = join(outputRoot, d);
      return { path: p, mtime: statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  // Keep every candidate built within the last 5 seconds of the newest one —
  // covers the case where wxt writes several related outputs in quick
  // succession (e.g. chrome-mv3 + chrome-mv3-beta via separate scripts).
  const distDirs = candidates.length
    ? candidates.filter((c) => candidates[0].mtime - c.mtime < 5_000).map((c) => c.path)
    : [];

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
