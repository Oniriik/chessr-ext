import { cpSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

mkdirSync(resolve(root, 'public/engine'), { recursive: true });

cpSync(
  resolve(root, 'node_modules/stockfish/bin/stockfish-18-lite-single.js'),
  resolve(root, 'public/engine/stockfish.js')
);
cpSync(
  resolve(root, 'node_modules/stockfish/bin/stockfish-18-lite-single.wasm'),
  resolve(root, 'public/engine/stockfish.wasm')
);

console.log('Stockfish WASM files copied to public/engine/');
