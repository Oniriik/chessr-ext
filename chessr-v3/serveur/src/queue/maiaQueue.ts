/**
 * BullMQ queue for Maia 2 native predictions.
 *
 * Mirrors suggestionQueue.ts (Komodo) and analysisQueue.ts (Stockfish):
 * producer = WS handler, worker = MaiaPool acquire → predict → release.
 *
 * The native binary returns raw `value + 1880 logits`. The worker layer
 * does the legal-move masking + softmax + top-N + UCI mirror-back so the
 * client receives ready-to-render suggestions, identical shape to what
 * the WASM-side MaiaSuggestionEngine produces.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { Chess } from 'chess.js';
import { redis } from './connection.js';
import { MaiaPool } from '../engine/MaiaPool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Move dictionary (1880 UCI strings, indices match logits) ──────────
// Loaded once at module import — same file the extension client uses.
const MOVES: string[] = JSON.parse(
  readFileSync(path.join(__dirname, '../engine/maia_moves.json'), 'utf8'),
);
const MOVES_INDEX: Map<string, number> = new Map(MOVES.map((m, i) => [m, i]));

// ─── Job types ─────────────────────────────────────────────────────────

export interface MaiaJobData {
  requestId: string;
  userId: string;
  fen: string;
  /** ELO bucket 0..10 (mapped client-side from raw ELO via eloBucketIndex). */
  eloSelf: number;
  eloOppo: number;
  /** Top-N suggestions to return (1..3 typically). */
  multiPv: number;
}

export interface MaiaSuggestion {
  multipv: number;
  move: string;             // UCI in original-board frame (mirror-corrected)
  evaluation: number;       // centipawns from value (Maia value → cp)
  depth: number;            // 0 — Maia is a single-shot policy net
  winRate: number;          // probability % of this move from Maia
  drawRate: number;         // 0
  lossRate: number;         // 100 - winRate
  mateScore: number | null; // null
  pv: string[];             // [move]
}

export interface MaiaJobResult {
  fen: string;
  positionEval: number;     // centipawns, white POV
  suggestions: MaiaSuggestion[];
}

// ─── Tuning ────────────────────────────────────────────────────────────

const QUEUE_NAME = 'maia-2';
const PRODUCER_TIMEOUT_MS = 15_000;
const LOCK_DURATION_MS = 30_000;

export const maiaQueue = new Queue<MaiaJobData, MaiaJobResult>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 100 },
    attempts: 1,
  },
});

let queueEvents: QueueEvents | null = null;
let worker: Worker<MaiaJobData, MaiaJobResult> | null = null;
let pool: MaiaPool | null = null;

// ─── Helpers ───────────────────────────────────────────────────────────

function mirrorSquare(sq: string): string {
  return sq[0] + (9 - parseInt(sq[1], 10));
}
function mirrorMove(uci: string): string {
  const promo = uci.length > 4 ? uci.slice(4) : '';
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}

/** Mirror a FEN board so black-to-move becomes white-to-move (Maia's
 *  trained POV). Castling rights and EP square are flipped too. */
function mirrorFen(fen: string): string {
  const [pieces, turn, castling, ep, half, full] = fen.split(' ');
  const rows = pieces.split('/').reverse().map((r) =>
    r.split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''),
  );
  const flippedCastling = castling === '-' ? '-' :
    castling.split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  const flippedEp = ep === '-' ? '-' : (ep[0] + (9 - parseInt(ep[1], 10)));
  return [rows.join('/'), turn === 'w' ? 'b' : 'w', flippedCastling, flippedEp, half, full].join(' ');
}

/** Maia value (-1..+1, side-to-move POV) → centipawns white POV. */
function valueToCp(value: number, isBlackToMove: boolean): number {
  const winProb = Math.max(0, Math.min(1, value / 2 + 0.5));
  const sideProb = isBlackToMove ? 1 - winProb : winProb;
  const clamped = Math.max(1e-4, Math.min(1 - 1e-4, sideProb));
  const cp = -400 * Math.log10((1 - clamped) / clamped);
  return Math.max(-2000, Math.min(2000, Math.round(cp)));
}

// ─── Worker logic ──────────────────────────────────────────────────────

async function processMaiaJob(job: Job<MaiaJobData, MaiaJobResult>): Promise<MaiaJobResult> {
  if (!pool) throw new Error('MaiaPool not initialised');
  const { fen, eloSelf, eloOppo, multiPv } = job.data;
  const isBlackToMove = fen.split(' ')[1] === 'b';
  const effectiveFen = isBlackToMove ? mirrorFen(fen) : fen;

  const inst = await pool.acquire();
  let raw;
  try {
    raw = await inst.predict(effectiveFen, eloSelf, eloOppo);
  } finally {
    pool.release(inst);
  }
  const { value, logits } = raw;

  // Build legal-move set in the model's frame (mirrored if applicable).
  const board = new Chess(effectiveFen);
  const legalUcis: string[] = [];
  for (const m of board.moves({ verbose: true })) {
    const uci = m.from + m.to + (m.promotion ?? '');
    if (MOVES_INDEX.has(uci)) legalUcis.push(uci);
  }

  if (legalUcis.length === 0) {
    return { fen, positionEval: valueToCp(value, isBlackToMove), suggestions: [] };
  }

  // Mask + softmax over legal moves only.
  const legalLogits = legalUcis.map((u) => logits[MOVES_INDEX.get(u)!]);
  const maxL = Math.max(...legalLogits);
  const exps = legalLogits.map((l) => Math.exp(l - maxL));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const probs = exps.map((e) => e / sum);

  // Top-N by probability.
  const ranked = legalUcis
    .map((uci, i) => ({ uci, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, Math.max(1, Math.min(3, multiPv)));

  const positionEval = valueToCp(value, isBlackToMove);
  const suggestions: MaiaSuggestion[] = ranked.map((r, idx) => {
    const outUci = isBlackToMove ? mirrorMove(r.uci) : r.uci;
    return {
      multipv: idx + 1,
      move: outUci,
      evaluation: positionEval,
      depth: 0,
      winRate: r.prob * 100,
      drawRate: 0,
      lossRate: (1 - r.prob) * 100,
      mateScore: null,
      pv: [outUci],
    };
  });

  return { fen, positionEval, suggestions };
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

export async function initMaiaWorker(maxInstances: number): Promise<void> {
  if (worker) return;
  pool = new MaiaPool(maxInstances);
  await pool.init();

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis });
  await queueEvents.waitUntilReady();

  worker = new Worker<MaiaJobData, MaiaJobResult>(
    QUEUE_NAME,
    (job) => processMaiaJob(job),
    {
      connection: redis,
      concurrency: maxInstances,
      lockDuration: LOCK_DURATION_MS,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[MaiaQueue] job ${job?.id} failed:`, err.message);
  });
  console.log(`[MaiaQueue] worker ready (concurrency=${maxInstances})`);
}

export async function enqueueMaia(data: MaiaJobData): Promise<MaiaJobResult> {
  if (!queueEvents) throw new Error('MaiaQueue not initialised');
  const jobId = `maia:${data.userId}:${data.requestId}`;
  const job = await maiaQueue.add('process', data, { jobId });
  return job.waitUntilFinished(queueEvents, PRODUCER_TIMEOUT_MS);
}

export async function removePendingMaiaForUser(userId: string): Promise<number> {
  const waiting = await maiaQueue.getWaiting(0, 100);
  let removed = 0;
  for (const job of waiting) {
    if (job.data.userId === userId) {
      try { await job.remove(); removed++; } catch { /* race */ }
    }
  }
  return removed;
}

export async function shutdownMaiaWorker(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (worker) tasks.push(worker.close());
  if (queueEvents) tasks.push(queueEvents.close());
  if (pool) tasks.push(pool.shutdown());
  await Promise.allSettled(tasks);
  worker = null;
  queueEvents = null;
  pool = null;
}
