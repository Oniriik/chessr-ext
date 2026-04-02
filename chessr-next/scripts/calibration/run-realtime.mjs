/**
 * Simulate real-time analysis: analyze every 2 plies (1 white + 1 black move)
 * Measures time per pair and compares with full-game CAPS
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SF_PATH = join(__dirname, '../../serveur/engines/macos/stockfish-16.1-m1');
const DEPTH = 18;
const BOOK_FENS_PATH = join(__dirname, 'book-fens.json');

// ─── CAPS formula (optimized on 5 games) ───

function computeCAPS2(diff) {
  const threshold = 0.10;
  if (diff <= threshold) return 100;
  const adj = diff - threshold;
  return Math.max(0, Math.min(100, 100 * Math.exp(-4.00 * Math.pow(adj, 1.95))));
}

// ─── Book ───
let bookFenSet = null;
function loadBookFens() {
  if (bookFenSet) return;
  if (!existsSync(BOOK_FENS_PATH)) { bookFenSet = new Set(); return; }
  bookFenSet = new Set(JSON.parse(readFileSync(BOOK_FENS_PATH, 'utf8')));
}
function fenKey(fen) { return fen.split(' ').slice(0, 3).join(' '); }
function isBookPosition(fen) { return bookFenSet.has(fenKey(fen)); }

// ─── Stockfish ───
class Stockfish {
  constructor() {
    this.proc = spawn(SF_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = ''; this.resolveWait = null;
  }
  async init() {
    this.proc.stdout.on('data', d => {
      this.buffer += d.toString();
      if (this.resolveWait && this.buffer.includes(this.waitFor)) {
        this.resolveWait(this.buffer); this.buffer = ''; this.resolveWait = null;
      }
    });
    this.send('uci'); await this.waitFor_('uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 1024');
    this.send('setoption name UCI_ShowWDL value true');
    this.send('isready'); await this.waitFor_('readyok');
  }
  send(cmd) { this.proc.stdin.write(cmd + '\n'); }
  waitFor_(marker) {
    return new Promise(r => {
      this.waitFor = marker;
      if (this.buffer.includes(marker)) { r(this.buffer); this.buffer = ''; }
      else this.resolveWait = r;
    });
  }
  async newGame() {
    this.send('ucinewgame');
    this.send('isready'); await this.waitFor_('readyok');
  }

  async analyze(fen) {
    this.send('isready'); await this.waitFor_('readyok');
    this.send('setoption name MultiPV value 1');
    this.send(`position fen ${fen}`);
    this.buffer = '';
    this.send(`go depth ${DEPTH}`);
    const out = await this.waitFor_('bestmove');
    const lines = out.split('\n').filter(l => l.startsWith('info') && l.includes(' pv '));
    if (!lines.length) return null;
    const line = lines[lines.length - 1];
    const cp = line.match(/score cp (-?\d+)/);
    const mate = line.match(/score mate (-?\d+)/);
    let evalCp = null;
    if (mate) evalCp = parseInt(mate[1]) > 0 ? 10000 : -10000;
    else if (cp) evalCp = parseInt(cp[1]);
    const pv = line.match(/ pv (.+?)(?:\s*$)/);
    return { evalCp, move: pv ? pv[1].trim().split(' ')[0] : null };
  }
  quit() { this.send('quit'); }
}

// ─── Get positions via python-chess ───
async function getPositions(pgn) {
  const { execSync } = await import('child_process');
  const sanMoves = pgn.replace(/\d+\.\s*/g, ' ').replace(/1-0|0-1|1\/2-1\/2|\*/g, '').trim().split(/\s+/).filter(m => m.length > 0);
  const pyScript = `
import chess, json
moves = json.loads('${JSON.stringify(sanMoves)}')
board = chess.Board()
pos = [{"fen": board.fen(), "ply": 0}]
for i, san in enumerate(moves):
    m = board.parse_san(san)
    board.push(m)
    pos.append({"fen": board.fen(), "move": san, "moveLan": m.uci(), "ply": i+1, "color": "white" if i%2==0 else "black"})
print(json.dumps(pos))
`;
  return JSON.parse(execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' }));
}

// ─── Analyze a pair of moves (white + black) ───
// Returns { wResult, bResult, timeMs }
// Each result: { diff, caps2, isBook }
async function analyzePair(sf, positions, pairIndex) {
  // pairIndex 0 = ply 1-2, pairIndex 1 = ply 3-4, etc.
  const wPly = pairIndex * 2 + 1;
  const bPly = pairIndex * 2 + 2;

  const results = { w: null, b: null, timeMs: 0 };
  const start = performance.now();

  // Clear hash once per pair (simulates getting a fresh SF from pool)
  await sf.newGame();

  // White move (ply wPly)
  if (wPly < positions.length) {
    const wPos = positions[wPly];
    if (wPos.isBook) {
      results.w = { diff: 0, caps2: 100, isBook: true, move: wPos.move };
    } else {
      const fenBefore = positions[wPly - 1].fen;
      const fenAfter = wPos.fen;
      const before = await sf.analyze(fenBefore);
      const after = await sf.analyze(fenAfter);
      if (before && after) {
        const bestEval = before.evalCp / 100;
        const afterEval = -after.evalCp / 100;
        const diff = Math.min(10, Math.max(0, bestEval - afterEval));
        results.w = { diff, caps2: computeCAPS2(diff), isBook: false, move: wPos.move, bestMove: before.move };
      }
    }
  }

  // Black move (ply bPly)
  if (bPly < positions.length) {
    const bPos = positions[bPly];
    if (bPos.isBook) {
      results.b = { diff: 0, caps2: 100, isBook: true, move: bPos.move };
    } else {
      const fenBefore = positions[bPly - 1].fen;
      const fenAfter = bPos.fen;
      const before = await sf.analyze(fenBefore);
      const after = await sf.analyze(fenAfter);
      if (before && after) {
        const bestEval = before.evalCp / 100;
        const afterEval = -after.evalCp / 100;
        const diff = Math.min(10, Math.max(0, bestEval - afterEval));
        results.b = { diff, caps2: computeCAPS2(diff), isBook: false, move: bPos.move, bestMove: before.move };
      }
    }
  }

  results.timeMs = performance.now() - start;
  return results;
}

// ─── Main ───
async function main() {
  const games = [
    {
      name: 'chessr-io vs qwerty (1780/1709)',
      pgn: '1. c3 d5 2. d3 Nf6 3. g3 e5 4. Bg2 Bd6 5. Qb3 c6 6. Bg5 Nbd7 7. Nd2 a5 8. c4 d4 9. Ne4 Bb4+ 10. Kf1 Nxe4 11. Bxd8 Nd2+ 12. Ke1 Nxb3+ 13. Kf1 Nxa1 14. Bg5 Nc2 15. Nf3 h6 16. Bc1 a4 17. a3 Be7 18. e4 dxe3 19. fxe3 Nc5 20. Ke2 e4 21. Kd2 exf3 22. Bxf3 Na1 23. d4 Ncb3+ 24. Kc3 Bf5 25. e4 Bh7 26. d5 Bf6+ 27. Kb4 Nc2#',
      cc: { w: 80.74, b: 94.77 },
    },
    {
      name: 'thoriq vs OshKosh (1600/1564)',
      pgn: '1. d4 d5 2. Bf4 e6 3. Nf3 Nc6 4. e3 Bd7 5. c3 Be7 6. Bd3 Nf6 7. Nbd2 O-O 8. Qc2 g6 9. h3 Nh5 10. Bh2 Ng7 11. a3 Bd6 12. Bxd6 cxd6 13. e4 dxe4 14. Bxe4 d5 15. Bd3 Ne7 16. Ne5 Be8 17. Ndf3 Nef5 18. O-O f6 19. Ng4 Nd6 20. Qd2 Ndf5 21. Rfe1 Qc8 22. Rac1 a6 23. c4 Bc6 24. b3 Qe8 25. a4 h5 26. Ne3 Nxe3 27. Qxe3 Bd7 28. Qh6 Nf5 29. Bxf5 gxf5 30. Nh4 Qf7 31. Ng6 Qh7 32. Qxh7+ Kxh7 33. Ne7 Rf7 34. cxd5 Rxe7 35. dxe6 Rxe6 36. Rxe6 Bxe6 37. Rc7+ Kg6 38. Rxb7 Bd5 39. Rb6 f4 40. f3 Kg5 41. Kf2 f5 42. a5 Rd8 43. Rxa6 Bxb3 44. Rb6 Bc4 45. a6 Rxd4 46. a7 Rd2+ 47. Kg1 Ra2 48. Rb7 Bd5 49. Rg7+ Kf6 50. Rh7 Kg6 51. Rd7 Ba8 52. Rc7 Kf6 53. Rh7 Kg6 54. Rd7 Kf6 55. Rd6+ Ke5 56. Rd7 Ke6 57. Rh7 Ke5 58. Re7+ Kf6 59. Rh7 Ra1+ 60. Kf2 Ra5 61. Ke2 Ke5 62. Re7+ Kf6 63. Rh7 Ra6 64. Rh6+ Ke5 65. Rxa6',
      cc: { w: 79.06, b: 74.00 },
    },
    {
      name: 'TorFredrik vs 1LifeB4 (3008/3013)',
      pgn: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h3 g6 7. g4 Bg7 8. Be3 Nc6 9. Qd2 O-O 10. O-O-O Nxd4 11. Bxd4 Qa5 12. Kb1 Be6 13. a3 b5 14. g5 Nh5 15. Nd5 Qd8 16. Bxg7 Nxg7 17. h4 Bxd5 18. Qxd5 Rc8 19. Be2 Rc5 20. Qd2 a5 21. h5 b4 22. a4 Qc7 23. hxg6 hxg6 24. Rh3 f6 25. gxf6 Rxf6 26. f4 e5 27. f5 gxf5 28. exf5 Kf7 29. Rh7 Kf8 30. Rg1 Rf7 31. f6 Rxf6 32. Qg5 Rf7 33. Rh8#',
      cc: { w: 90.80, b: 76.84 },
    },
  ];

  loadBookFens();

  for (const game of games) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${game.name}`);
    console.log(`${'='.repeat(80)}\n`);

    const positions = await getPositions(game.pgn);

    // Detect book
    let bookPly = 0;
    for (let i = 1; i < positions.length; i++) {
      if (isBookPosition(positions[i].fen)) { bookPly = i; positions[i].isBook = true; }
      else { for (let j = i; j < positions.length; j++) positions[j].isBook = false; break; }
    }
    console.log(`Book: ${bookPly} ply`);

    const totalMoves = positions.length - 1;
    const totalPairs = Math.ceil(totalMoves / 2);

    const sf = new Stockfish();
    await sf.init();

    let wAllCaps = [], bAllCaps = [];
    let totalTimeMs = 0;
    const pairTimes = [];

    console.log(`\n${'Pair'.padEnd(5)} | ${'Moves'.padEnd(20)} | ${'W CAPS'.padEnd(8)} | ${'B CAPS'.padEnd(8)} | ${'Run W'.padEnd(7)} | ${'Run B'.padEnd(7)} | ${'Time'.padEnd(7)}`);
    console.log('-'.repeat(80));

    for (let p = 0; p < totalPairs; p++) {
      const result = await analyzePair(sf, positions, p);
      totalTimeMs += result.timeMs;
      pairTimes.push(result.timeMs);

      if (result.w) {
        wAllCaps.push(result.w.caps2);
      }
      if (result.b) {
        bAllCaps.push(result.b.caps2);
      }

      const runW = wAllCaps.length > 0 ? (wAllCaps.reduce((a, b) => a + b, 0) / wAllCaps.length).toFixed(1) : '-';
      const runB = bAllCaps.length > 0 ? (bAllCaps.reduce((a, b) => a + b, 0) / bAllCaps.length).toFixed(1) : '-';

      const wMove = result.w ? (result.w.isBook ? `${result.w.move}(book)` : result.w.move) : '-';
      const bMove = result.b ? (result.b.isBook ? `${result.b.move}(book)` : result.b.move) : '-';

      console.log([
        `${p + 1}`.padEnd(5),
        `${wMove} / ${bMove}`.padEnd(20),
        result.w ? result.w.caps2.toFixed(1).padEnd(8) : '-'.padEnd(8),
        result.b ? result.b.caps2.toFixed(1).padEnd(8) : '-'.padEnd(8),
        runW.padEnd(7),
        runB.padEnd(7),
        `${(result.timeMs / 1000).toFixed(1)}s`,
      ].join(' | '));
    }

    sf.quit();

    const finalW = wAllCaps.reduce((a, b) => a + b, 0) / wAllCaps.length;
    const finalB = bAllCaps.reduce((a, b) => a + b, 0) / bAllCaps.length;
    const avgPairTime = totalTimeMs / totalPairs;

    console.log(`\n--- Summary ---`);
    console.log(`  Total time: ${(totalTimeMs / 1000).toFixed(1)}s (${totalPairs} pairs)`);
    console.log(`  Avg per pair: ${(avgPairTime / 1000).toFixed(2)}s (${(avgPairTime).toFixed(0)}ms)`);
    console.log(`  Max pair time: ${(Math.max(...pairTimes) / 1000).toFixed(2)}s`);
    console.log(`  Min pair time: ${(Math.min(...pairTimes) / 1000).toFixed(2)}s`);
    console.log(`  White CAPS: ${finalW.toFixed(1)} (CC: ${game.cc.w})  err: ${(finalW - game.cc.w).toFixed(1)}`);
    console.log(`  Black CAPS: ${finalB.toFixed(1)} (CC: ${game.cc.b})  err: ${(finalB - game.cc.b).toFixed(1)}`);
  }
}

main().catch(console.error);
