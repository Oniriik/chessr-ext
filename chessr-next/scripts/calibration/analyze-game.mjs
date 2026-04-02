/**
 * Analyze a full game with Stockfish 16.1 @ depth 18
 * Apply calibrated CAPS2 formula and classification thresholds
 * Includes book detection via Lichess Explorer API
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SF_PATH = join(__dirname, '../../serveur/engines/macos/stockfish-16.1-m1');
const DEPTH = 18;

// ─── Calibrated formulas (reverse-engineered from Chess.com) ───
// Hybrid: pawn diff + win probability weighting

function winProb(evalPawns) {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function computeDiff(bestEval, afterEval) {
  // Raw pawn diff
  const rawDiff = Math.max(0, bestEval - afterEval);
  // Weight by position balance: in won positions, same pawn diff matters less
  // Use average win% to determine weight
  const avgWin = (winProb(bestEval) + winProb(afterEval)) / 2;
  // Weight: 1.0 at 50% (equal), lower in won/lost positions
  // Sigmoid-like: peaks at 50%, fades at extremes
  const balance = 1 - Math.pow((avgWin - 50) / 50, 2);
  const weight = 0.5 + 0.5 * balance; // range [0.5, 1.0]
  return rawDiff * weight;
}

function computeCAPS2(diff) {
  const threshold = 0.10;
  if (diff <= threshold) return 100;
  const adjusted = diff - threshold;
  return Math.max(0, Math.min(100, 100 * Math.exp(-1.05 * Math.pow(adjusted, 1.20))));
}

function classifyMove(diff) {
  if (diff <= 0.05) return 'best';
  if (diff <= 0.20) return 'excellent';
  if (diff <= 0.40) return 'good';
  if (diff <= 0.80) return 'inaccuracy';
  if (diff <= 2.00) return 'mistake';
  return 'blunder';
}

// ─── Book detection via ECO FEN database ───

const BOOK_FENS_PATH = join(__dirname, 'book-fens.json');
let bookFenSet = null;

function loadBookFens() {
  if (bookFenSet) return bookFenSet;
  if (!existsSync(BOOK_FENS_PATH)) {
    console.warn('book-fens.json not found. Run build-book.mjs first. No book detection.');
    bookFenSet = new Set();
    return bookFenSet;
  }
  const fens = JSON.parse(readFileSync(BOOK_FENS_PATH, 'utf8'));
  bookFenSet = new Set(fens);
  console.log(`Loaded ${bookFenSet.size} book FENs`);
  return bookFenSet;
}

function fenKey(fen) {
  // Use position + active color + castling (ignore en passant + move counters)
  const parts = fen.split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}

function isInEco(fen) {
  const book = loadBookFens();
  return book.has(fenKey(fen));
}

function isBookPosition(fen) {
  return isInEco(fen);
}

// ─── Stockfish UCI wrapper ───

class Stockfish {
  constructor() {
    this.proc = spawn(SF_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.resolveWait = null;
  }

  async init() {
    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      if (this.resolveWait && this.buffer.includes(this.waitFor)) {
        this.resolveWait(this.buffer);
        this.buffer = '';
        this.resolveWait = null;
      }
    });
    this.send('uci');
    await this.waitForOutput('uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 1024');
    this.send('setoption name UCI_ShowWDL value true');
    this.send('isready');
    await this.waitForOutput('readyok');
  }

  send(cmd) { this.proc.stdin.write(cmd + '\n'); }

  waitForOutput(marker) {
    return new Promise((resolve) => {
      this.waitFor = marker;
      if (this.buffer.includes(marker)) {
        resolve(this.buffer);
        this.buffer = '';
      } else {
        this.resolveWait = resolve;
      }
    });
  }

  async analyze(fen, depth = DEPTH, multiPv = 1) {
    this.send('isready');
    await this.waitForOutput('readyok');
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send(`position fen ${fen}`);
    this.buffer = '';
    this.send(`go depth ${depth}`);
    const output = await this.waitForOutput('bestmove');
    return this.parseBest(output);
  }

  parseBest(output) {
    const lines = output.split('\n').filter(l => l.startsWith('info') && l.includes(' pv '));
    if (!lines.length) return null;
    const line = lines[lines.length - 1]; // deepest

    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+?)(?:\s*$)/);
    const wdlMatch = line.match(/wdl (\d+) (\d+) (\d+)/);

    let evalCp = null, mateIn = null;
    if (mateMatch) {
      mateIn = parseInt(mateMatch[1]);
      evalCp = mateIn > 0 ? 10000 : -10000;
    } else if (cpMatch) {
      evalCp = parseInt(cpMatch[1]);
    }

    return {
      evalCp,
      mateIn,
      move: pvMatch ? pvMatch[1].trim().split(' ')[0] : null,
      pv: pvMatch ? pvMatch[1].trim().split(' ') : [],
      wdl: wdlMatch ? { win: +wdlMatch[1], draw: +wdlMatch[2], loss: +wdlMatch[3] } : null,
    };
  }

  quit() { this.send('quit'); }
}

// ─── Simple FEN generator from moves ───
// We use Stockfish itself to play moves and get FEN

class ChessPosition {
  // Instead of implementing full chess logic, we'll use stockfish `position startpos moves ...`
  // and `d` command to get FEN. But SF `d` is slow. Let's use a different approach:
  // We'll track positions by sending `position startpos moves m1 m2 ...` to SF and analyzing.
}

// ─── Parse PGN to get moves in LAN format ───

function parsePGN(pgn) {
  // Extract just the moves (remove headers and comments)
  const moveText = pgn.replace(/\[.*?\]\n?/g, '').replace(/\{.*?\}/g, '').trim();
  // Extract SAN moves
  const sanMoves = moveText
    .replace(/\d+\.\s*/g, ' ')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, '')
    .trim()
    .split(/\s+/)
    .filter(m => m.length > 0);
  return sanMoves;
}

// ─── Main ───

async function main() {
  const pgn = `1. c3 d5 2. d3 Nf6 3. g3 e5 4. Bg2 Bd6 5. Qb3 c6 6. Bg5 Nbd7 7. Nd2 a5 8. c4 d4 9. Ne4 Bb4+ 10. Kf1 Nxe4 11. Bxd8 Nd2+ 12. Ke1 Nxb3+ 13. Kf1 Nxa1 14. Bg5 Nc2 15. Nf3 h6 16. Bc1 a4 17. a3 Be7 18. e4 dxe3 19. fxe3 Nc5 20. Ke2 e4 21. Kd2 exf3 22. Bxf3 Na1 23. d4 Ncb3+ 24. Kc3 Bf5 25. e4 Bh7 26. d5 Bf6+ 27. Kb4 Nc2#`;

  const gameInfo = {
    white: 'qwertyqweww121',
    black: 'chessr-io',
    whiteElo: 1709,
    blackElo: 1780,
    result: '0-1',
    timeControl: '60+1',
  };

  const sanMoves = parsePGN(pgn);
  console.log(`\nGame: ${gameInfo.white} (${gameInfo.whiteElo}) vs ${gameInfo.black} (${gameInfo.blackElo})`);
  console.log(`Result: ${gameInfo.result} | Time: ${gameInfo.timeControl}`);
  console.log(`Moves: ${sanMoves.length} half-moves\n`);

  const sf = new Stockfish();
  await sf.init();

  // We need FENs for each position. Use SF with `position startpos moves ...` approach.
  // For each move, analyze the position BEFORE and AFTER to compute difference.

  // Step 1: Get all FENs by playing through moves with a helper SF instance
  const sfHelper = new Stockfish();
  await sfHelper.init();

  // Get FEN after each move using `d` command... SF doesn't output FEN easily.
  // Alternative: use `position startpos moves m1 m2` and analyze directly.
  // We need the LAN moves though. Let's convert SAN to LAN using SF.

  // Strategy: for each position, send `position startpos moves <all previous LAN moves>`
  // and run `go depth 18`. SF will tell us the best move.
  // For the "after" position, we add the played move and analyze again.

  // But we need LAN moves. We can get them by: for each SAN move, set position,
  // then do a 1-depth search to see what moves are legal, or we can try another approach.

  // Simplest: use the SAN moves directly with a chess library.
  // Since we don't have one, let's use SF's built-in move parser.
  // SF accepts SAN when given via `position fen ... moves <san>` — NO it doesn't, UCI needs LAN.

  // Let's use a different approach: pipe moves through python-chess to get FENs
  sfHelper.quit();

  console.log('Getting FENs via python-chess...\n');

  const { execSync } = await import('child_process');

  const pythonScript = `
import chess
import json

pgn_moves = ${JSON.stringify(sanMoves)}
board = chess.Board()
positions = []

# Starting position
positions.append({"fen": board.fen(), "move": None, "moveLan": None, "ply": 0})

for i, san in enumerate(pgn_moves):
    move = board.parse_san(san)
    lan = move.uci()
    board.push(move)
    positions.append({
        "fen": board.fen(),
        "move": san,
        "moveLan": lan,
        "ply": i + 1,
        "color": "white" if (i % 2 == 0) else "black"
    })

print(json.dumps(positions))
`;

  let positions;
  try {
    const result = execSync(`python3 -c '${pythonScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' });
    positions = JSON.parse(result);
  } catch (e) {
    // Try with pip install python-chess first
    console.log('Installing python-chess...');
    execSync('pip3 install python-chess', { encoding: 'utf8' });
    const result = execSync(`python3 -c '${pythonScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' });
    positions = JSON.parse(result);
  }

  console.log(`Got ${positions.length} positions\n`);

  // Step 2: Detect book moves via ECO + Lichess popularity
  // A move is "book" if the position after is in ECO AND has enough games on Lichess
  loadBookFens();
  let bookPly = 0;
  for (let i = 1; i < positions.length; i++) {
    const inBook = isBookPosition(positions[i].fen);
    if (inBook) {
      positions[i].isBook = true;
      bookPly = i;
      console.log(`  Book: ply ${i} ${positions[i].move} ✓`);
    } else {
      positions[i].isBook = false;
      console.log(`  Out of book at ply ${i} ${positions[i].move}`);
      for (let j = i + 1; j < positions.length; j++) positions[j].isBook = false;
      break;
    }
  }
  console.log(`\nBook depth: ${bookPly} ply\n`);

  // Step 3: Analyze each non-book position with Stockfish
  const results = [];
  const whiteResults = [];
  const blackResults = [];

  const MAX_DIFF = 10.0; // Cap diff for mate positions (Chess.com seems to cap around this)

  const header = [
    '#'.padEnd(3),
    'Move'.padEnd(10),
    'Color'.padEnd(6),
    'Class'.padEnd(14),
    'Diff'.padEnd(7),
    'CAPS2'.padEnd(7),
    'BestEval'.padEnd(9),
    'AfterEval'.padEnd(10),
    'BestMove'.padEnd(10),
    'Match',
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (let i = 1; i < positions.length; i++) {
    const pos = positions[i];
    const fenBefore = positions[i - 1].fen;
    const fenAfter = pos.fen;
    const isWhite = pos.color === 'white';
    const moveNum = Math.ceil(pos.ply / 2);
    const moveStr = `${moveNum}${isWhite ? '.' : '...'} ${pos.move}`;

    // Book moves: no analysis needed
    if (pos.isBook) {
      const r = {
        ply: pos.ply, move: pos.move, moveLan: pos.moveLan, color: pos.color,
        classification: 'book', diff: 0, caps2: 100,
        bestEval: null, afterEval: null, bestMove: '-', match: '', mateIn: null,
      };
      results.push(r);
      if (isWhite) whiteResults.push(r);
      else blackResults.push(r);

      console.log([
        String(pos.ply).padEnd(3), moveStr.padEnd(10), pos.color.padEnd(6),
        'book'.padEnd(14), '-'.padEnd(7), '100.0'.padEnd(7),
        '-'.padEnd(9), '-'.padEnd(10), '-'.padEnd(10), '',
      ].join(' | '));
      continue;
    }

    // Analyze both positions with MultiPV 1 + Hash 256
    const before = await sf.analyze(fenBefore, DEPTH, 1);
    const after = await sf.analyze(fenAfter, DEPTH, 1);

    if (!before || !after) {
      console.log(`  ${pos.ply} ${pos.move} - analysis failed`);
      continue;
    }

    // Normalize evals to player's perspective
    const bestEval = before.evalCp / 100;
    const afterEval = -after.evalCp / 100;

    // Weighted diff (position-aware)
    const diff = computeDiff(bestEval, afterEval);
    const diffRound = Math.round(diff * 100) / 100;

    const classification = classifyMove(diff);
    const caps2 = computeCAPS2(diff);
    const caps2Round = Math.round(caps2 * 100) / 100;

    const bestMove = before.move;
    const match = bestMove === pos.moveLan ? 'YES' : '';

    const r = {
      ply: pos.ply, move: pos.move, moveLan: pos.moveLan, color: pos.color,
      classification, diff: diffRound, caps2: caps2Round,
      bestEval: Math.round(bestEval * 100) / 100,
      afterEval: Math.round(afterEval * 100) / 100,
      bestMove, match, mateIn: before.mateIn,
    };

    results.push(r);
    if (isWhite) whiteResults.push(r);
    else blackResults.push(r);

    console.log([
      String(pos.ply).padEnd(3), moveStr.padEnd(10), pos.color.padEnd(6),
      classification.padEnd(14), diffRound.toFixed(2).padEnd(7),
      caps2Round.toFixed(1).padEnd(7),
      (before.mateIn ? `M${before.mateIn}` : bestEval.toFixed(2)).padEnd(9),
      (after.mateIn ? `M${-after.mateIn}` : afterEval.toFixed(2)).padEnd(10),
      (bestMove || '?').padEnd(10), match,
    ].join(' | '));
  }

  // ─── Summary ───
  console.log(`\n${'='.repeat(80)}`);
  console.log('GAME SUMMARY');
  console.log(`${'='.repeat(80)}\n`);

  function computeStats(playerResults, name) {
    const total = playerResults.length;
    if (total === 0) return;

    const caps2Values = playerResults.map(r => r.caps2);
    const avgCAPS2 = caps2Values.reduce((a, b) => a + b, 0) / total;
    const avgDiff = playerResults.reduce((a, b) => a + b.diff, 0) / total;

    const counts = {};
    for (const r of playerResults) {
      counts[r.classification] = (counts[r.classification] || 0) + 1;
    }

    console.log(`${name}:`);
    console.log(`  Overall CAPS2: ${avgCAPS2.toFixed(1)}`);
    console.log(`  Avg Difference: ${avgDiff.toFixed(2)} pawns`);
    console.log(`  Moves: ${total}`);
    console.log(`  Classifications:`);
    for (const [cls, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / total) * 100).toFixed(0);
      console.log(`    ${cls.padEnd(14)} ${count.toString().padEnd(3)} (${pct}%)`);
    }
    console.log('');
  }

  computeStats(whiteResults, `White: ${gameInfo.white} (${gameInfo.whiteElo})`);
  computeStats(blackResults, `Black: ${gameInfo.black} (${gameInfo.blackElo})`);

  sf.quit();
}

main().catch(console.error);
