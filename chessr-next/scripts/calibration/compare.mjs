/**
 * Compare Chess.com analysis with our Stockfish 16.1 at depth 18
 * Goal: reverse-engineer classification thresholds and CAPS formula
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SF_PATH = join(__dirname, '../../serveur/engines/macos/stockfish-16.1-m1');
const DEPTH = 18;
const MULTIPV = 2;

// ─── Stockfish UCI wrapper ───

class Stockfish {
  constructor() {
    this.proc = spawn(SF_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.resolveWait = null;
    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      if (this.resolveWait && this.buffer.includes(this.waitFor)) {
        this.resolveWait(this.buffer);
        this.buffer = '';
        this.resolveWait = null;
      }
    });
  }

  send(cmd) {
    this.proc.stdin.write(cmd + '\n');
  }

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

  async init() {
    this.send('uci');
    await this.waitForOutput('uciok');
    this.send('setoption name Threads value 1');
    this.send('setoption name Hash value 128');
    this.send('setoption name UCI_ShowWDL value true');
    this.send('isready');
    await this.waitForOutput('readyok');
  }

  async analyze(fen, depth = DEPTH, multiPv = MULTIPV) {
    this.send('ucinewgame');
    this.send('isready');
    await this.waitForOutput('readyok');
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send(`position fen ${fen}`);
    this.buffer = '';
    this.send(`go depth ${depth}`);
    const output = await this.waitForOutput('bestmove');
    return this.parseOutput(output);
  }

  parseOutput(output) {
    const lines = output.split('\n');
    const results = [];

    // Get the deepest info line for each PV
    const pvMap = new Map();
    for (const line of lines) {
      if (!line.startsWith('info') || !line.includes(' pv ')) continue;
      const depthMatch = line.match(/depth (\d+)/);
      const pvIdxMatch = line.match(/multipv (\d+)/);
      const pvIdx = pvIdxMatch ? parseInt(pvIdxMatch[1]) : 1;
      const depth = depthMatch ? parseInt(depthMatch[1]) : 0;

      // Only keep deepest for each PV
      const existing = pvMap.get(pvIdx);
      if (!existing || depth > existing.depth) {
        pvMap.set(pvIdx, { line, depth });
      }
    }

    for (const [pvIdx, { line }] of [...pvMap.entries()].sort((a, b) => a[0] - b[0])) {
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv (.+?)(?:\s+bmc|$)/);
      const depthMatch = line.match(/depth (\d+)/);
      const wdlMatch = line.match(/wdl (\d+) (\d+) (\d+)/);

      let evalCp = null;
      let mateIn = null;

      if (mateMatch) {
        mateIn = parseInt(mateMatch[1]);
        evalCp = mateIn > 0 ? 10000 : -10000;
      } else if (cpMatch) {
        evalCp = parseInt(cpMatch[1]);
      }

      results.push({
        pvIndex: pvIdx,
        evalCp,
        mateIn,
        depth: depthMatch ? parseInt(depthMatch[1]) : null,
        move: pvMatch ? pvMatch[1].split(' ')[0] : null,
        pv: pvMatch ? pvMatch[1].trim().split(' ') : [],
        wdl: wdlMatch ? {
          win: parseInt(wdlMatch[1]),
          draw: parseInt(wdlMatch[2]),
          loss: parseInt(wdlMatch[3]),
        } : null,
      });
    }

    return results;
  }

  quit() {
    this.send('quit');
  }
}

// ─── Main comparison ───

async function main() {
  const data = JSON.parse(readFileSync(join(__dirname, 'chesscom-data.json'), 'utf8'));
  const sf = new Stockfish();
  await sf.init();

  console.log(`\n${'='.repeat(120)}`);
  console.log(`Comparing Chess.com analysis vs Stockfish 16.1 @ depth ${DEPTH}`);
  console.log(`Game: ${data.game}`);
  console.log(`${'='.repeat(120)}\n`);

  const header = [
    'Ply'.padEnd(4),
    'Move'.padEnd(8),
    'Color'.padEnd(6),
    'CC Class'.padEnd(14),
    'CC Diff'.padEnd(8),
    'CC CAPS2'.padEnd(9),
    'CC BestEval'.padEnd(12),
    'CC PlayEval'.padEnd(12),
    'SF BestEval'.padEnd(12),
    'SF AfterEval'.padEnd(13),
    'SF CPL'.padEnd(8),
    'SF BestMove'.padEnd(12),
    'CC BestMove'.padEnd(12),
    'Match?',
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(header.length));

  const results = [];

  for (const pos of data.positions) {
    if (pos.classification === 'book' || pos.fen === 'checkmate') {
      console.log([
        String(pos.ply).padEnd(4),
        pos.move.padEnd(8),
        pos.color.padEnd(6),
        pos.classification.padEnd(14),
        '-'.padEnd(8),
        '-'.padEnd(9),
        '-'.padEnd(12),
        '-'.padEnd(12),
        '(book/mate)'.padEnd(12),
        '-'.padEnd(13),
        '-'.padEnd(8),
        '-'.padEnd(12),
        '-'.padEnd(12),
        '-',
      ].join(' | '));
      continue;
    }

    // We need fenBefore (position before the move) to get best eval
    // The fen in our data is fenAfter (after the move was played)
    // We need to find the previous position's fen
    const posIdx = data.positions.indexOf(pos);
    const prevPos = data.positions[posIdx - 1];
    if (!prevPos || prevPos.fen === 'checkmate') continue;

    const fenBefore = prevPos.fen;
    const fenAfter = pos.fen;

    // Analyze position before (to get best move and eval)
    const beforeResults = await sf.analyze(fenBefore, DEPTH, 2);
    const bestResult = beforeResults[0];

    // Analyze position after (to get eval after played move)
    const afterResults = await sf.analyze(fenAfter, DEPTH, 1);
    const afterResult = afterResults[0];

    // Normalize evals to player's perspective
    const isWhite = pos.color === 'white';
    const sfBestEval = bestResult?.evalCp != null
      ? (isWhite ? bestResult.evalCp : -bestResult.evalCp)
      : null;
    // After the move, it's opponent's turn, so flip
    const sfAfterEval = afterResult?.evalCp != null
      ? (isWhite ? -afterResult.evalCp : afterResult.evalCp)
      : null;

    const sfCpl = (sfBestEval != null && sfAfterEval != null)
      ? Math.max(0, sfBestEval - sfAfterEval)
      : null;

    const sfBestMove = bestResult?.move ?? '?';
    const bestMoveMatch = sfBestMove === pos.bestMove ? 'YES' : 'no';

    results.push({
      ply: pos.ply,
      move: pos.move,
      color: pos.color,
      ccClass: pos.classification,
      ccDiff: pos.difference,
      ccCaps2: pos.caps2,
      ccBestEval: pos.bestEvalCp,
      ccPlayedEval: pos.playedEvalCp,
      sfBestEval,
      sfAfterEval,
      sfCpl,
      sfBestMove,
      ccBestMove: pos.bestMove,
      bestMoveMatch,
    });

    console.log([
      String(pos.ply).padEnd(4),
      pos.move.padEnd(8),
      pos.color.padEnd(6),
      pos.classification.padEnd(14),
      String(pos.difference).padEnd(8),
      String(pos.caps2).padEnd(9),
      String(pos.bestEvalCp ?? '-').padEnd(12),
      String(pos.playedEvalCp ?? '-').padEnd(12),
      String(sfBestEval ?? '-').padEnd(12),
      String(sfAfterEval ?? '-').padEnd(13),
      String(sfCpl ?? '-').padEnd(8),
      sfBestMove.padEnd(12),
      pos.bestMove.padEnd(12),
      bestMoveMatch,
    ].join(' | '));
  }

  // ─── Summary stats ───
  console.log(`\n${'='.repeat(80)}`);
  console.log('ANALYSIS SUMMARY');
  console.log(`${'='.repeat(80)}\n`);

  // Classification → CPL mapping
  const classMap = {};
  for (const r of results) {
    if (!classMap[r.ccClass]) classMap[r.ccClass] = [];
    classMap[r.ccClass].push({
      ccDiff: r.ccDiff,
      sfCpl: r.sfCpl,
      ccCaps2: r.ccCaps2,
    });
  }

  console.log('Classification → CPL ranges:');
  console.log('-'.repeat(80));
  for (const [cls, entries] of Object.entries(classMap)) {
    const diffs = entries.map(e => e.ccDiff).filter(v => v != null);
    const cpls = entries.map(e => e.sfCpl).filter(v => v != null);
    const caps = entries.map(e => e.ccCaps2).filter(v => v != null);

    console.log(`  ${cls.padEnd(14)} | ` +
      `CC diff: [${Math.min(...diffs).toFixed(2)} - ${Math.max(...diffs).toFixed(2)}] ` +
      `avg=${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2)} | ` +
      `SF CPL: [${Math.min(...cpls)} - ${Math.max(...cpls)}] ` +
      `avg=${(cpls.reduce((a, b) => a + b, 0) / cpls.length).toFixed(0)} | ` +
      `CAPS2: [${Math.min(...caps).toFixed(1)} - ${Math.max(...caps).toFixed(1)}] ` +
      `avg=${(caps.reduce((a, b) => a + b, 0) / caps.length).toFixed(1)} | ` +
      `n=${entries.length}`
    );
  }

  // CAPS2 vs CPL correlation
  console.log('\nCAPS2 formula analysis (CC diff → CAPS2):');
  console.log('-'.repeat(60));
  for (const r of results) {
    if (r.ccDiff > 0) {
      console.log(`  diff=${String(r.ccDiff).padEnd(6)} → CAPS2=${String(r.ccCaps2).padEnd(8)} | sfCPL=${String(r.sfCpl).padEnd(5)} | ${r.ccClass}`);
    }
  }

  sf.quit();
}

main().catch(console.error);
