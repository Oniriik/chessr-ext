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

// Torch (Chess.com Explanation Engine, 25 MB). Vendored at the repo
// root because it's binary + chess.com-licensed content, distributed
// out-of-band like dragon3.3.wasm. WARNING: do NOT swap to the newer
// chess.com torch-lite.wasm (6.5 MB) — its WebAssembly imports require
// the matching newer chess.com torch.js shell, which is not API-compat
// with our existing torch-patched.js. The shell-vs-wasm ABI mismatch
// throws "Import #0 'a': module is not an object" on instantiation.
// File name kept as torch-lite.wasm at the vendor root for historical
// reasons (we briefly experimented with the lite WASM in 3.0.13 and
// rolled back in 3.0.14).
const torchWasm = resolve(repoRoot, 'torch-lite.wasm');
if (!existsSync(torchWasm)) throw new Error(`Missing ${torchWasm}`);
cpSync(torchWasm, resolve(root, 'public/engine/torch.wasm'));

console.log('Engine WASM files copied to public/engine/');
