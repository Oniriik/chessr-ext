/**
 * Compare move classifications between our formula and Chess.com
 * Uses the diffs already computed from run-all.mjs
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SF_PATH = join(__dirname, '../../serveur/engines/macos/stockfish-16.1-m1');
const DEPTH = 18;
const BOOK_FENS_PATH = join(__dirname, 'book-fens.json');

// ─── Formulas ───
function computeCAPS2(diff) {
  if (diff <= 0.10) return 100;
  return Math.max(0, Math.min(100, 100 * Math.exp(-4.00 * Math.pow(diff - 0.10, 1.95))));
}

function classifyMove(diff) {
  if (diff <= 0.08) return 'best';
  if (diff <= 0.20) return 'excellent';
  if (diff <= 0.45) return 'good';
  if (diff <= 0.80) return 'inaccuracy';
  if (diff <= 2.00) return 'mistake';
  return 'blunder';
}

// ─── Book ───
let bookFenSet = null;
function loadBookFens() {
  if (bookFenSet) return;
  bookFenSet = existsSync(BOOK_FENS_PATH) ? new Set(JSON.parse(readFileSync(BOOK_FENS_PATH, 'utf8'))) : new Set();
}
function fenKey(fen) { return fen.split(' ').slice(0, 3).join(' '); }
function isBookFen(fen) { return bookFenSet.has(fenKey(fen)); }

// ─── SF ───
class Stockfish {
  constructor() { this.proc = spawn(SF_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] }); this.buffer = ''; this.resolveWait = null; }
  async init() {
    this.proc.stdout.on('data', d => { this.buffer += d.toString(); if (this.resolveWait && this.buffer.includes(this.waitFor)) { this.resolveWait(this.buffer); this.buffer = ''; this.resolveWait = null; } });
    this.send('uci'); await this.wf('uciok');
    this.send('setoption name Threads value 1'); this.send('setoption name Hash value 1024'); this.send('isready'); await this.wf('readyok');
  }
  send(cmd) { this.proc.stdin.write(cmd + '\n'); }
  wf(m) { return new Promise(r => { this.waitFor = m; if (this.buffer.includes(m)) { r(this.buffer); this.buffer = ''; } else this.resolveWait = r; }); }
  async analyze(fen) {
    this.send('isready'); await this.wf('readyok');
    this.send('setoption name MultiPV value 1');
    this.send(`position fen ${fen}`); this.buffer = '';
    this.send(`go depth ${DEPTH}`);
    const out = await this.wf('bestmove');
    const lines = out.split('\n').filter(l => l.startsWith('info') && l.includes(' pv '));
    if (!lines.length) return null;
    const line = lines[lines.length - 1];
    const cp = line.match(/score cp (-?\d+)/), mate = line.match(/score mate (-?\d+)/);
    let ev = null;
    if (mate) ev = parseInt(mate[1]) > 0 ? 10000 : -10000;
    else if (cp) ev = parseInt(cp[1]);
    const pv = line.match(/ pv (.+?)(?:\s*$)/);
    return { evalCp: ev, move: pv ? pv[1].trim().split(' ')[0] : null };
  }
  quit() { this.send('quit'); }
}

async function getPositions(pgn) {
  const { execSync } = await import('child_process');
  const san = pgn.replace(/\d+\.\s*/g, ' ').replace(/1-0|0-1|1\/2-1\/2|\*/g, '').trim().split(/\s+/).filter(m => m);
  const py = `import chess,json\nm=json.loads('${JSON.stringify(san)}')\nb=chess.Board()\np=[{"fen":b.fen(),"ply":0}]\nfor i,s in enumerate(m):\n mv=b.parse_san(s);b.push(mv);p.append({"fen":b.fen(),"move":s,"lan":mv.uci(),"ply":i+1,"color":"white" if i%2==0 else "black"})\nprint(json.dumps(p))`;
  return JSON.parse(execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' }));
}

// ─── Chess.com classifications extracted from their data ───
const ccClassifications = {
  'chessr-io vs qwerty': {
    // ply: classification from Chess.com positions data
    1: 'book', 2: 'book',
    3: 'inaccuracy', 4: 'excellent', 5: 'excellent', 6: 'best', 7: 'excellent', 8: 'excellent',
    9: 'good', 10: 'best', 11: 'excellent', 12: 'best', 13: 'best', 14: 'best',
    15: 'good', 16: 'inaccuracy', 17: 'good', 18: 'best', 19: 'blunder', 20: 'excellent',
    21: 'excellent', 22: 'best', 23: 'excellent', 24: 'excellent', 25: 'inaccuracy', 26: 'good',
    27: 'good', 28: 'excellent', 29: 'best', 30: 'excellent', 31: 'excellent', 32: 'excellent',
    33: 'excellent', 34: 'excellent', 35: 'excellent', 36: 'best', 37: 'best', 38: 'best',
    39: 'excellent', 40: 'excellent', 41: 'inaccuracy', 42: 'excellent', 43: 'best', 44: 'best',
    45: 'best', 46: 'best', 47: 'best', 48: 'good', 49: 'best', 50: 'best',
    51: 'mistake', 52: 'inaccuracy', 53: 'blunder', 54: 'best',
  },
  'TorFredrik vs 1LifeB4': {
    // From CC data: bookPly=14, then analyzed positions
    1: 'book', 2: 'book', 3: 'book', 4: 'book', 5: 'book', 6: 'book', 7: 'book',
    8: 'book', 9: 'book', 10: 'book', 11: 'book', 12: 'book', 13: 'book', 14: 'book',
    15: 'best', 16: 'good', 17: 'best', 18: 'best', 19: 'best', 20: 'best',
    21: 'best', 22: 'good', 23: 'best', 24: 'best', 25: 'best', 26: 'best',
    27: 'best', 28: 'best', 29: 'best', 30: 'good', 31: 'best', 32: 'best',
    33: 'excellent', 34: 'best', 35: 'inaccuracy', 36: 'best', 37: 'excellent', 38: 'best',
    39: 'excellent', 40: 'inaccuracy', 41: 'best', 42: 'best', 43: 'excellent', 44: 'good',
    45: 'best', 46: 'blunder', 47: 'best', 48: 'excellent', 49: 'best', 50: 'excellent',
    51: 'inaccuracy', 52: 'best', 53: 'excellent', 54: 'mistake', 55: 'best', 56: 'best',
    57: 'blunder', 58: 'blunder', 59: 'mistake', 60: 'mistake', 61: 'best', 62: 'best',
    63: 'best', 64: 'best', 65: 'best',
  },
};

async function main() {
  const games = [
    { name: 'chessr-io vs qwerty', pgn: '1. c3 d5 2. d3 Nf6 3. g3 e5 4. Bg2 Bd6 5. Qb3 c6 6. Bg5 Nbd7 7. Nd2 a5 8. c4 d4 9. Ne4 Bb4+ 10. Kf1 Nxe4 11. Bxd8 Nd2+ 12. Ke1 Nxb3+ 13. Kf1 Nxa1 14. Bg5 Nc2 15. Nf3 h6 16. Bc1 a4 17. a3 Be7 18. e4 dxe3 19. fxe3 Nc5 20. Ke2 e4 21. Kd2 exf3 22. Bxf3 Na1 23. d4 Ncb3+ 24. Kc3 Bf5 25. e4 Bh7 26. d5 Bf6+ 27. Kb4 Nc2#' },
    { name: 'TorFredrik vs 1LifeB4', pgn: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h3 g6 7. g4 Bg7 8. Be3 Nc6 9. Qd2 O-O 10. O-O-O Nxd4 11. Bxd4 Qa5 12. Kb1 Be6 13. a3 b5 14. g5 Nh5 15. Nd5 Qd8 16. Bxg7 Nxg7 17. h4 Bxd5 18. Qxd5 Rc8 19. Be2 Rc5 20. Qd2 a5 21. h5 b4 22. a4 Qc7 23. hxg6 hxg6 24. Rh3 f6 25. gxf6 Rxf6 26. f4 e5 27. f5 gxf5 28. exf5 Kf7 29. Rh7 Kf8 30. Rg1 Rf7 31. f6 Rxf6 32. Qg5 Rf7 33. Rh8#' },
  ];

  loadBookFens();

  for (const game of games) {
    const ccCls = ccClassifications[game.name];
    if (!ccCls) continue;

    console.log(`\n${'='.repeat(90)}`);
    console.log(game.name);
    console.log(`${'='.repeat(90)}\n`);

    const positions = await getPositions(game.pgn);

    // Book detection
    let bookPly = 0;
    for (let i = 1; i < positions.length; i++) {
      if (isBookFen(positions[i].fen)) { bookPly = i; positions[i].isBook = true; }
      else { for (let j = i; j < positions.length; j++) positions[j].isBook = false; break; }
    }

    const sf = new Stockfish();
    await sf.init();

    let match = 0, total = 0, offByOne = 0;
    const order = ['book', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

    console.log(`${'#'.padEnd(4)} | ${'Move'.padEnd(8)} | ${'CC Class'.padEnd(14)} | ${'Our Class'.padEnd(14)} | ${'Diff'.padEnd(7)} | Match`);
    console.log('-'.repeat(70));

    for (let i = 1; i < positions.length; i++) {
      const pos = positions[i];
      const cc = ccCls[i];
      if (!cc) continue;

      let ourCls, diff;
      if (pos.isBook) {
        ourCls = 'book'; diff = 0;
      } else {
        const before = await sf.analyze(positions[i - 1].fen);
        const after = await sf.analyze(pos.fen);
        if (!before || !after) continue;
        const bestEval = before.evalCp / 100;
        const afterEval = -after.evalCp / 100;
        diff = Math.min(10, Math.max(0, bestEval - afterEval));
        ourCls = classifyMove(diff);
      }

      const isMatch = ourCls === cc;
      const ccIdx = order.indexOf(cc);
      const ourIdx = order.indexOf(ourCls);
      const isOffByOne = Math.abs(ccIdx - ourIdx) <= 1 && !isMatch;

      if (isMatch) match++;
      if (isOffByOne) offByOne++;
      total++;

      const icon = isMatch ? '✓' : isOffByOne ? '~' : '✗';

      console.log([
        `${i}`.padEnd(4),
        pos.move.padEnd(8),
        cc.padEnd(14),
        ourCls.padEnd(14),
        pos.isBook ? '-'.padEnd(7) : diff.toFixed(2).padEnd(7),
        icon,
      ].join(' | '));
    }

    sf.quit();

    console.log(`\n--- Classification accuracy ---`);
    console.log(`  Exact match: ${match}/${total} (${(match/total*100).toFixed(0)}%)`);
    console.log(`  Off by one:  ${offByOne}/${total} (${(offByOne/total*100).toFixed(0)}%)`);
    console.log(`  Match + off-by-one: ${match+offByOne}/${total} (${((match+offByOne)/total*100).toFixed(0)}%)`);
    console.log(`  Wrong (>1 off): ${total-match-offByOne}/${total} (${((total-match-offByOne)/total*100).toFixed(0)}%)`);
  }
}

main().catch(console.error);
