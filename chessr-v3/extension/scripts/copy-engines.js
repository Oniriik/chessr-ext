import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const repoRoot = resolve(root, '..');

mkdirSync(resolve(root, 'public/engine'), { recursive: true });

// Stockfish (from npm)
cpSync(
  resolve(root, 'node_modules/stockfish/bin/stockfish-18-lite-single.js'),
  resolve(root, 'public/engine/stockfish.js'),
);
cpSync(
  resolve(root, 'node_modules/stockfish/bin/stockfish-18-lite-single.wasm'),
  resolve(root, 'public/engine/stockfish.wasm'),
);

// Dragon (from repo-local vendor files)
const dragonJs = resolve(root, 'assets/dragon.js');
const dragonWasm = resolve(repoRoot, 'dragon3.3.wasm');
const dragonBook = resolve(root, 'assets/book.bin');
if (!existsSync(dragonJs)) throw new Error(`Missing ${dragonJs}`);
if (!existsSync(dragonWasm)) throw new Error(`Missing ${dragonWasm}`);
if (!existsSync(dragonBook)) throw new Error(`Missing ${dragonBook}`);
cpSync(dragonJs, resolve(root, 'public/engine/dragon.js'));
cpSync(dragonWasm, resolve(root, 'public/engine/dragon.wasm'));
cpSync(dragonBook, resolve(root, 'public/engine/book.bin'));

// Chess.com Explanation Engine — the only wasm that implements the
// `fetch analysis` UCI extension (classification, CAPS, effective Elo).
// Single-threaded build, no SAB requirement; works on any host page.
// Vendor file names at repo root are still `torch-lite.*` for historical
// reasons but the bytes ARE explanation-engine (verified: strings include
// `chesscom.explanation_engine.v1.CeeVersionRequest`).
const ceeJs = resolve(repoRoot, 'torch-lite.js');
const ceeWasm = resolve(repoRoot, 'torch-lite.wasm');
if (!existsSync(ceeJs)) throw new Error(`Missing ${ceeJs}`);
if (!existsSync(ceeWasm)) throw new Error(`Missing ${ceeWasm}`);
cpSync(ceeJs, resolve(root, 'public/engine/explanation-engine.js'));
cpSync(ceeWasm, resolve(root, 'public/engine/explanation-engine.wasm'));

// Rodent IV — classical UCI engine, built from vendored sources at
// chessr-v3/rodent-sources/ via scripts/build-rodent-wasm.sh. Personalities
// (.txt files) are baked into rodent.data via Emscripten's --preload-file,
// so we only ship js + wasm + data.
const rodentDir = resolve(root, 'public/engine/rodent');
mkdirSync(rodentDir, { recursive: true });
const rodentJs   = resolve(repoRoot, 'rodent.js');
const rodentWasm = resolve(repoRoot, 'rodent.wasm');
const rodentData = resolve(repoRoot, 'rodent.data');
if (!existsSync(rodentJs) || !existsSync(rodentWasm) || !existsSync(rodentData)) {
  throw new Error(
    `Missing Rodent artifacts at repo root. Run: scripts/build-rodent-wasm.sh\n` +
    `  Expected: rodent.js, rodent.wasm, rodent.data`,
  );
}
cpSync(rodentJs,   resolve(rodentDir, 'rodent.js'));
cpSync(rodentWasm, resolve(rodentDir, 'rodent.wasm'));
cpSync(rodentData, resolve(rodentDir, 'rodent.data'));

console.log('Engine WASM files copied to public/engine/');
