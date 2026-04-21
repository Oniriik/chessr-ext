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

console.log('Engine WASM files copied to public/engine/');
