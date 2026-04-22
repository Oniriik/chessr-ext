// Copies onnxruntime-web's WASM/JS assets into public/ort/ so they can be
// served from the same origin (required for SharedArrayBuffer / threading).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");
const DST = path.join(ROOT, "public", "ort");

if (!fs.existsSync(SRC)) {
  console.error(`onnxruntime-web not installed at ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DST, { recursive: true });
let count = 0;
for (const f of fs.readdirSync(SRC)) {
  if (/\.(wasm|mjs|js)$/.test(f)) {
    fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
    count++;
  }
}
console.log(`copied ${count} ORT asset(s) → public/ort/`);
