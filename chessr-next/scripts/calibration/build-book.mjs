/**
 * Download ECO database and build a FEN set for book detection
 * Outputs a JSON file with all book FENs
 */

import https from 'https';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const fenSet = new Set();
  let totalEntries = 0;

  for (const letter of ['A', 'B', 'C', 'D', 'E']) {
    const url = `https://raw.githubusercontent.com/hayatbiralem/eco.json/master/eco${letter}.json`;
    console.log(`Fetching eco${letter}.json...`);
    const data = await fetchJSON(url);
    const count = Object.keys(data).length;
    totalEntries += count;

    for (const entry of Object.values(data)) {
      const moves = entry.moves;
      if (!moves) continue;

      // We need to replay the moves to get FENs at each position
      // We'll store the moves string and parse later with python-chess
      // For now, just collect all move sequences
      fenSet.add(moves);
    }
    console.log(`  ${count} entries`);
  }

  console.log(`\nTotal: ${totalEntries} openings, ${fenSet.size} unique move sequences`);

  // Use python-chess to convert all move sequences to FENs
  // Count how many ECO entries pass through each position (popularity proxy)
  console.log('\nConverting to FENs via python-chess...');

  const { execSync } = await import('child_process');
  const movesArray = [...fenSet];

  // Process in batches — count occurrences of each FEN across all ECO entries
  const fenCounts = new Map(); // fen -> number of ECO entries that pass through it
  const BATCH = 500;

  for (let i = 0; i < movesArray.length; i += BATCH) {
    const batch = movesArray.slice(i, i + BATCH);
    const pythonScript = `
import chess
import json

move_sequences = json.loads('''${JSON.stringify(batch)}''')
fen_counts = {}

for seq in move_sequences:
    board = chess.Board()
    parts = board.fen().split(' ')
    key = f"{parts[0]} {parts[1]} {parts[2]}"
    fen_counts[key] = fen_counts.get(key, 0) + 1

    tokens = seq.replace('.', ' ').split()
    for token in tokens:
        if token[0].isdigit():
            continue
        try:
            move = board.parse_san(token)
            board.push(move)
            parts = board.fen().split(' ')
            key = f"{parts[0]} {parts[1]} {parts[2]}"
            fen_counts[key] = fen_counts.get(key, 0) + 1
        except:
            break

print(json.dumps(fen_counts))
`;
    try {
      const result = execSync(`python3 -c '${pythonScript.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
      const counts = JSON.parse(result);
      for (const [fen, count] of Object.entries(counts)) {
        fenCounts.set(fen, (fenCounts.get(fen) || 0) + count);
      }
    } catch (e) {
      console.error(`Batch ${i}-${i + BATCH} failed:`, e.message?.slice(0, 100));
    }
    process.stdout.write(`  Processed ${Math.min(i + BATCH, movesArray.length)}/${movesArray.length} sequences (${fenCounts.size} FENs)\r`);
  }

  // Filter: only keep positions that appear in multiple ECO entries (popular positions)
  const MIN_ECO_COUNT = 4; // position must be in at least 4 ECO lines
  const allFens = new Set();
  for (const [fen, count] of fenCounts) {
    if (count >= MIN_ECO_COUNT) allFens.add(fen);
  }

  console.log(`\n\nTotal FENs: ${fenCounts.size}`);
  console.log(`FENs with >= ${MIN_ECO_COUNT} ECO entries: ${allFens.size}`);

  // Show some examples of filtered-out positions
  const filtered = [...fenCounts.entries()].filter(([, c]) => c < MIN_ECO_COUNT);
  console.log(`Filtered out: ${filtered.length} rare positions`);
  filtered.slice(0, 5).forEach(([f, c]) => console.log(`  ${c}x: ${f}`));

  // Save as JSON array
  const outPath = join(__dirname, 'book-fens.json');
  writeFileSync(outPath, JSON.stringify([...allFens]));
  const sizeMB = (JSON.stringify([...allFens]).length / 1024 / 1024).toFixed(1);
  console.log(`Saved to ${outPath} (${sizeMB} MB)`);
}

main().catch(console.error);
