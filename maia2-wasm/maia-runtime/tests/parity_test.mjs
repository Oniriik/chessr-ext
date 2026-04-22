// Numerical-parity test: compare our custom WASM Maia runtime against the
// PyTorch reference on a fixed set of positions.
//
// Run after building the Node variant of the runtime:
//   cd ../wasm && MASTER_PUBLIC_KEY_HEX=... LICENSE_URL=http://localhost:8080/api/license/verify ./build.sh
//   (then re-build with -s ENVIRONMENT=node and copy maia_node.js next to this file)
//
// Then:
//   node parity_test.mjs reference.json
//
// reference.json is produced by ../scripts/make_reference.py (PyTorch).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

if (process.argv.length < 3) {
  console.error('Usage: node parity_test.mjs reference.json');
  process.exit(1);
}
const refPath = process.argv[2];
const reference = JSON.parse(readFileSync(refPath, 'utf8'));

const createModule = require('./maia_node.js');
const mod = await createModule({});
const init = mod.cwrap('wasm_init', null, []);
const setAuth = mod.cwrap('wasm_set_auth_token', null, ['string']);
const predict = mod.cwrap('wasm_predict', 'number', ['string', 'number', 'number']);
const logitsPtr = mod.cwrap('wasm_logits_ptr', 'number', []);
const logitsCount = mod.cwrap('wasm_logits_count', 'number', []);
const valueOf = mod.cwrap('wasm_value', 'number', []);

init();
// For parity testing we bypass the license check by stubbing it server-side
// or by building with a debug flag. The test harness assumes the WASM is
// built so that license_verify always passes (debug build).
setAuth('test-bypass');

let pass = 0;
let fail = 0;
for (const tc of reference.cases) {
  const ok = predict(tc.fen, BigInt(tc.eloSelf), BigInt(tc.eloOppo));
  if (!ok) {
    console.log(`FAIL ${tc.fen.slice(0, 32)}…  (predict returned 0)`);
    fail++; continue;
  }
  const N = logitsCount();
  const ptr = logitsPtr();
  const logits = new Float32Array(mod.HEAPF32.buffer, ptr, N);
  const value = valueOf();

  // Compare top-3 moves (highest logits)
  const ourTop = Array.from(logits).map((v, i) => [v, i])
    .sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
  const refTop = tc.top3_indices;

  const setEqual = ourTop.every(i => refTop.includes(i)) && refTop.every(i => ourTop.includes(i));
  const valueDiff = Math.abs(value - tc.value);

  if (setEqual && valueDiff < 0.05) {
    pass++;
    if (process.env.VERBOSE) console.log(`OK   ${tc.fen.slice(0,32)}…  top3=[${ourTop}] value=${value.toFixed(3)} (vs ${tc.value.toFixed(3)})`);
  } else {
    fail++;
    console.log(`FAIL ${tc.fen.slice(0,32)}…  top3 ours=[${ourTop}] ref=[${refTop}]  value ours=${value.toFixed(4)} ref=${tc.value.toFixed(4)} (diff ${valueDiff.toFixed(4)})`);
  }
}

console.log(`\n${pass}/${pass + fail} positions matched (${(100 * pass / (pass + fail)).toFixed(1)}%)`);
process.exit(fail > 0 ? 1 : 0);
