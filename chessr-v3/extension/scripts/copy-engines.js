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

// Torch (Chess.com Explanation Engine). The shell JS and WASM must be
// from the SAME chess.com release — the WASM declares imports the shell
// exports, and a mismatch throws "Import #0 'a': module is not an
// object" at instantiation. We currently ship the older 25 MB torch
// build (single-threaded, no SAB requirement). The newer chess.com
// "lite" WASM (6.5 MB) is 4× smaller and tempting, BUT its companion
// shell uses pthread + SharedArrayBuffer — content-script Workers
// inherit the host page's COOP/COEP, and chess.com / lichess /
// worldchess don't set them, so SAB is unavailable and the worker
// throws `SharedArrayBuffer is not defined` on init. Until we either
// (a) get a single-threaded build of the lite shell from chess.com,
// (b) bundle a proxy iframe with COOP/COEP and host the worker there,
// or (c) write our own non-pthread driver around the lite WASM, we
// have to stay on the working 25 MB combo (file names kept as
// torch-lite.* at the vendor root for historical reasons).
const torchJs = resolve(repoRoot, 'torch-lite.js');
const torchWasm = resolve(repoRoot, 'torch-lite.wasm');
if (!existsSync(torchJs)) throw new Error(`Missing ${torchJs}`);
if (!existsSync(torchWasm)) throw new Error(`Missing ${torchWasm}`);
cpSync(torchJs, resolve(root, 'public/engine/torch.js'));
cpSync(torchWasm, resolve(root, 'public/engine/torch.wasm'));

console.log('Engine WASM files copied to public/engine/');
