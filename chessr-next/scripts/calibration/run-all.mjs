/**
 * Quick test of all 3 games to compare CAPS with Chess.com
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SF_PATH = join(__dirname, '../../serveur/engines/macos/stockfish-m1');
const DEPTH = 18;
const BOOK_FENS_PATH = join(__dirname, 'book-fens.json');

// ─── Formulas ───

function computeDiff(bestEval, afterEval) {
  return Math.min(10, Math.max(0, bestEval - afterEval));
}

function computeCAPS2(diff) {
  const threshold = 0.19;
  if (diff <= threshold) return 100;
  const adj = diff - threshold;
  return Math.max(0, Math.min(100, 100 * Math.exp(-4.00 * Math.pow(adj, 1.95))));
}

// ─── Phase detection (material-based, same as analysisHandler.ts) ───
function detectPhase(fen) {
  const board = fen.split(' ')[0];
  const values = { q: 9, Q: 9, r: 5, R: 5, b: 3, B: 3, n: 3, N: 3, p: 1, P: 1 };
  let material = 0;
  for (const ch of board) material += values[ch] || 0;
  const ratio = material / 78;
  if (ratio > 0.85) return 'opening';
  if (ratio > 0.35) return 'middlegame';
  return 'endgame';
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
    const pv = line.match(/ pv (.+?)(?:\s*$)/);
    let evalCp = null;
    if (mate) evalCp = parseInt(mate[1]) > 0 ? 10000 : -10000;
    else if (cp) evalCp = parseInt(cp[1]);
    return { evalCp, move: pv ? pv[1].trim().split(' ')[0] : null };
  }
  quit() { this.send('quit'); }
}

// ─── Analyze game ───
async function analyzeGame(pgn, info) {
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
  const positions = JSON.parse(execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' }));

  loadBookFens();
  let bookPly = 0;
  for (let i = 1; i < positions.length; i++) {
    if (isBookPosition(positions[i].fen)) { bookPly = i; positions[i].isBook = true; }
    else { for (let j = i; j < positions.length; j++) positions[j].isBook = false; break; }
  }

  const sf = new Stockfish();
  await sf.init();

  // { diff, phase } per move (-1 diff = book)
  const wMoves = [], bMoves = [];

  for (let i = 1; i < positions.length; i++) {
    const pos = positions[i];
    const fenBefore = positions[i - 1].fen;
    const phase = detectPhase(fenBefore);

    if (pos.isBook) {
      (pos.color === 'white' ? wMoves : bMoves).push({ diff: -1, phase });
      continue;
    }

    const before = await sf.analyze(fenBefore);
    const after = await sf.analyze(pos.fen);
    if (!before || !after) continue;

    const bestEval = before.evalCp / 100;
    const afterEval = -after.evalCp / 100;
    const diff = computeDiff(bestEval, afterEval);

    (pos.color === 'white' ? wMoves : bMoves).push({ diff, phase });
  }

  sf.quit();

  function calcCAPS(moves) {
    if (!moves.length) return null;
    const caps = moves.map(m => m.diff < 0 ? 100 : computeCAPS2(m.diff));
    return caps.reduce((a, b) => a + b, 0) / caps.length;
  }

  function calcPhaseCAPS(moves, phase) {
    const filtered = moves.filter(m => m.phase === phase);
    return calcCAPS(filtered);
  }

  return {
    bookPly,
    whiteCAPS: calcCAPS(wMoves),
    blackCAPS: calcCAPS(bMoves),
    whiteGp0: calcPhaseCAPS(wMoves, 'opening'),
    whiteGp1: calcPhaseCAPS(wMoves, 'middlegame'),
    whiteGp2: calcPhaseCAPS(wMoves, 'endgame'),
    blackGp0: calcPhaseCAPS(bMoves, 'opening'),
    blackGp1: calcPhaseCAPS(bMoves, 'middlegame'),
    blackGp2: calcPhaseCAPS(bMoves, 'endgame'),
    wDiffs: wMoves.map(m => m.diff),
    bDiffs: bMoves.map(m => m.diff),
  };
}

// ─── Main ───
async function main() {
  const games = [
    {
      name: 'chessr-io vs qwerty (1780/1709)',
      pgn: '1. c3 d5 2. d3 Nf6 3. g3 e5 4. Bg2 Bd6 5. Qb3 c6 6. Bg5 Nbd7 7. Nd2 a5 8. c4 d4 9. Ne4 Bb4+ 10. Kf1 Nxe4 11. Bxd8 Nd2+ 12. Ke1 Nxb3+ 13. Kf1 Nxa1 14. Bg5 Nc2 15. Nf3 h6 16. Bc1 a4 17. a3 Be7 18. e4 dxe3 19. fxe3 Nc5 20. Ke2 e4 21. Kd2 exf3 22. Bxf3 Na1 23. d4 Ncb3+ 24. Kc3 Bf5 25. e4 Bh7 26. d5 Bf6+ 27. Kb4 Nc2#',
      cc: { w: 80.74, b: 94.77, book: 2, wGp0: 70.03, wGp1: null, wGp2: null, bGp0: 93.7, bGp1: null, bGp2: null },
    },
    {
      name: 'jaxceq vs massnabi (361/322)',
      pgn: '1. e4 Nf6 2. e5 Ne4 3. d3 Ng5 4. h4 Ne6 5. b4 Nc6 6. b5 Nb4 7. c3 Nd5 8. c4 Nb4 9. a3 Nxd3+ 10. Qxd3 c6 11. bxc6 bxc6 12. a4 Ba6 13. Nf3 Nc5 14. Qd4 d6 15. exd6 exd6 16. Qe3+ Kd7 17. h5 Rb8 18. Nc3 Rb3 19. h6 gxh6 20. g3 Bg7 21. Bh3+ Kc7 22. Nd4 Bxc4 23. Nxb3 Re8 24. Ne4 Nxb3 25. Rb1 Bd4 26. Qf3 d5 27. Qxf7+ Kb6 28. Bd7 Rxe4+ 29. Kd1 Be2+ 30. Kc2 Re7 31. Rxb3+ Ka6 32. Qf5 Rxd7 33. Rxh6 Re7 34. Rxc6+ Bb6 35. Rcxb6+ Ka5 36. Bd2+ Kxa4 37. Ra6+ Bxa6 38. Qf4+ d4 39. Be3 Rc7+ 40. Kb2 Qc8 41. Qxd4+ Bc4 42. Ra3+ Kb4 43. Qc3+ Kb5 44. Qa5+ Kc6 45. Qa4+ Bb5 46. Rc3+ Kb7 47. Rxc7+ Qxc7 48. Qxb5+ Kc8 49. Qe8+ Kb7 50. f4 a6 51. f5 a5 52. f6 a4 53. f7 Qb6+ 54. Bxb6 Kxb6 55. f8=Q a3+ 56. Kxa3 h6 57. Qxh6+ Kc5 58. Qe5+ Kc4 59. Qh4+ Kd3 60. Qd5+ Kc2 61. Qhc4+ Kb1 62. Qd1#',
      cc: { w: 54.77, b: 47.46, book: 3, wGp0: 68.67, wGp1: 39.04, wGp2: 84.45, bGp0: 56.87, bGp1: 33.83, bGp2: 53.84 },
    },
    {
      name: 'thoriq vs OshKosh (1600/1564)',
      pgn: '1. d4 d5 2. Bf4 e6 3. Nf3 Nc6 4. e3 Bd7 5. c3 Be7 6. Bd3 Nf6 7. Nbd2 O-O 8. Qc2 g6 9. h3 Nh5 10. Bh2 Ng7 11. a3 Bd6 12. Bxd6 cxd6 13. e4 dxe4 14. Bxe4 d5 15. Bd3 Ne7 16. Ne5 Be8 17. Ndf3 Nef5 18. O-O f6 19. Ng4 Nd6 20. Qd2 Ndf5 21. Rfe1 Qc8 22. Rac1 a6 23. c4 Bc6 24. b3 Qe8 25. a4 h5 26. Ne3 Nxe3 27. Qxe3 Bd7 28. Qh6 Nf5 29. Bxf5 gxf5 30. Nh4 Qf7 31. Ng6 Qh7 32. Qxh7+ Kxh7 33. Ne7 Rf7 34. cxd5 Rxe7 35. dxe6 Rxe6 36. Rxe6 Bxe6 37. Rc7+ Kg6 38. Rxb7 Bd5 39. Rb6 f4 40. f3 Kg5 41. Kf2 f5 42. a5 Rd8 43. Rxa6 Bxb3 44. Rb6 Bc4 45. a6 Rxd4 46. a7 Rd2+ 47. Kg1 Ra2 48. Rb7 Bd5 49. Rg7+ Kf6 50. Rh7 Kg6 51. Rd7 Ba8 52. Rc7 Kf6 53. Rh7 Kg6 54. Rd7 Kf6 55. Rd6+ Ke5 56. Rd7 Ke6 57. Rh7 Ke5 58. Re7+ Kf6 59. Rh7 Ra1+ 60. Kf2 Ra5 61. Ke2 Ke5 62. Re7+ Kf6 63. Rh7 Ra6 64. Rh6+ Ke5 65. Rxa6',
      cc: { w: 79.06, b: 74.00, book: 5, wGp0: 94.16, wGp1: 73.64, wGp2: 80.35, bGp0: 90.08, bGp1: 72.83, bGp2: 70.09 },
    },
    {
      name: 'rabin vs exited (1861/1896)',
      pgn: '1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. Nf3 c6 5. Be2 Bg4 6. O-O Bxf3 7. Bxf3 e6 8. d4 Qc7 9. Qe2 Nd7 10. d5 e5 11. dxc6 bxc6 12. Bf4 Bd6 13. Rad1 O-O-O 14. Be3 Kb8 15. Ne4 Be7 16. Rd3 Ngf6 17. Rb3+ Ka8 18. Ra3 Nb6 19. Qa6 Bxa3 20. Qxa3 Nfd5 21. Bc5 f5 22. Nd6 e4 23. Be2 g6 24. b4 Rxd6 25. b5 Rdd8 26. bxc6 Qxc6 27. Rb1 h5 28. c4 Nf4 29. Bf1 Rb8 30. g3 g5 31. gxf4 gxf4 32. Bh3 Rhg8+ 33. Kf1 e3 34. Bxf5 Qg2+ 35. Ke1 Qxf2+ 36. Kd1 Qd2#',
      cc: { w: 57.86, b: 72.44, book: 7, wGp0: 97.57, wGp1: 43.77, wGp2: null, bGp0: 97.4, bGp1: 67.45, bGp2: null }
    },
    {
      name: 'TorFredrik vs 1LifeB4 (3008/3013)',
      pgn: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h3 g6 7. g4 Bg7 8. Be3 Nc6 9. Qd2 O-O 10. O-O-O Nxd4 11. Bxd4 Qa5 12. Kb1 Be6 13. a3 b5 14. g5 Nh5 15. Nd5 Qd8 16. Bxg7 Nxg7 17. h4 Bxd5 18. Qxd5 Rc8 19. Be2 Rc5 20. Qd2 a5 21. h5 b4 22. a4 Qc7 23. hxg6 hxg6 24. Rh3 f6 25. gxf6 Rxf6 26. f4 e5 27. f5 gxf5 28. exf5 Kf7 29. Rh7 Kf8 30. Rg1 Rf7 31. f6 Rxf6 32. Qg5 Rf7 33. Rh8#',
      cc: { w: 90.80, b: 76.84, book: 14, wGp0: 100, wGp1: 86.2, wGp2: null, bGp0: 96.01, bGp1: 66.79, bGp2: null },
    },
  ];

  console.log('Analyzing 5 games...\n');

  // Step 1: Collect all diffs
  const allResults = [];
  for (const game of games) {
    process.stdout.write(`${game.name}... `);
    const result = await analyzeGame(game.pgn, game);
    allResults.push({ ...game, ...result });
    console.log(`done (book: ${result.bookPly})`);
  }

  // Step 2: Show results with per-phase breakdown
  const fmt = (v) => v != null ? v.toFixed(1) : '-';
  const err = (ours, cc) => (ours != null && cc != null) ? (ours - cc).toFixed(1) : '-';

  console.log('\n--- Overall + Per-Phase CAPS comparison ---\n');
  for (const r of allResults) {
    console.log(`${r.name} (book: ${r.bookPly})`);
    console.log(`         ${'Overall'.padEnd(10)} ${'Opening'.padEnd(10)} ${'Middle'.padEnd(10)} ${'Endgame'.padEnd(10)}`);
    console.log(`  W CC:  ${fmt(r.cc.w).padEnd(10)} ${fmt(r.cc.wGp0).padEnd(10)} ${fmt(r.cc.wGp1).padEnd(10)} ${fmt(r.cc.wGp2).padEnd(10)}`);
    console.log(`  W us:  ${fmt(r.whiteCAPS).padEnd(10)} ${fmt(r.whiteGp0).padEnd(10)} ${fmt(r.whiteGp1).padEnd(10)} ${fmt(r.whiteGp2).padEnd(10)}`);
    console.log(`  W err: ${err(r.whiteCAPS, r.cc.w).padEnd(10)} ${err(r.whiteGp0, r.cc.wGp0).padEnd(10)} ${err(r.whiteGp1, r.cc.wGp1).padEnd(10)} ${err(r.whiteGp2, r.cc.wGp2).padEnd(10)}`);
    console.log(`  B CC:  ${fmt(r.cc.b).padEnd(10)} ${fmt(r.cc.bGp0).padEnd(10)} ${fmt(r.cc.bGp1).padEnd(10)} ${fmt(r.cc.bGp2).padEnd(10)}`);
    console.log(`  B us:  ${fmt(r.blackCAPS).padEnd(10)} ${fmt(r.blackGp0).padEnd(10)} ${fmt(r.blackGp1).padEnd(10)} ${fmt(r.blackGp2).padEnd(10)}`);
    console.log(`  B err: ${err(r.blackCAPS, r.cc.b).padEnd(10)} ${err(r.blackGp0, r.cc.bGp0).padEnd(10)} ${err(r.blackGp1, r.cc.bGp1).padEnd(10)} ${err(r.blackGp2, r.cc.bGp2).padEnd(10)}`);
    console.log('');
  }

  // Step 3: Sweep CAPS formula parameters on collected diffs
  console.log('\n--- Parameter sweep ---\n');

  function testParams(threshold, k, p) {
    function caps(diff) {
      if (diff < 0) return 100; // book
      if (diff <= threshold) return 100;
      const adj = diff - threshold;
      return Math.max(0, Math.min(100, 100 * Math.exp(-k * Math.pow(adj, p))));
    }
    function avg(diffs) {
      const c = diffs.map(d => caps(d));
      return c.reduce((a, b) => a + b, 0) / c.length;
    }

    let totalErr = 0;
    for (const r of allResults) {
      totalErr += Math.abs(avg(r.wDiffs) - r.cc.w);
      totalErr += Math.abs(avg(r.bDiffs) - r.cc.b);
    }
    return totalErr / (allResults.length * 2);
  }

  let bestErr = Infinity;
  let bestParams = null;

  for (let t = 0; t <= 0.20; t += 0.01) {
    for (let k = 0.5; k <= 4.0; k += 0.05) {
      for (let p = 0.5; p <= 2.0; p += 0.05) {
        const err = testParams(t, k, p);
        if (err < bestErr) {
          bestErr = err;
          bestParams = { t, k, p };
        }
      }
    }
  }

  console.log(`Best params: threshold=${bestParams.t.toFixed(2)}, k=${bestParams.k.toFixed(2)}, p=${bestParams.p.toFixed(2)}`);
  console.log(`Avg error: ${bestErr.toFixed(1)}\n`);

  // Show results with best params
  function capsWithParams(diff, t, k, p) {
    if (diff < 0) return 100;
    if (diff <= t) return 100;
    const adj = diff - t;
    return Math.max(0, Math.min(100, 100 * Math.exp(-k * Math.pow(adj, p))));
  }

  console.log('--- Results with best params ---\n');
  for (const r of allResults) {
    const wCaps = r.wDiffs.map(d => capsWithParams(d, bestParams.t, bestParams.k, bestParams.p));
    const bCaps = r.bDiffs.map(d => capsWithParams(d, bestParams.t, bestParams.k, bestParams.p));
    const avgW = wCaps.reduce((a, b) => a + b, 0) / wCaps.length;
    const avgB = bCaps.reduce((a, b) => a + b, 0) / bCaps.length;
    console.log(`${r.name}`);
    console.log(`  W: ${avgW.toFixed(1)} (CC: ${r.cc.w})  err: ${(avgW - r.cc.w).toFixed(1)}`);
    console.log(`  B: ${avgB.toFixed(1)} (CC: ${r.cc.b})  err: ${(avgB - r.cc.b).toFixed(1)}`);
  }

  console.log(`\n--- TypeScript ---\n`);
  console.log(`function computeCAPS2(diff: number): number {`);
  console.log(`  const threshold = ${bestParams.t.toFixed(2)};`);
  console.log(`  if (diff <= threshold) return 100;`);
  console.log(`  const adj = diff - threshold;`);
  console.log(`  return Math.max(0, Math.min(100, 100 * Math.exp(-${bestParams.k.toFixed(2)} * Math.pow(adj, ${bestParams.p.toFixed(2)}))));`);
  console.log(`}`);
}

main().catch(console.error);
