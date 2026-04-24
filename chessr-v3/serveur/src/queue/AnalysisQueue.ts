/**
 * BullMQ analysis queue — mirror of suggestionQueue.ts for Stockfish.
 *
 * Two job kinds share the same queue:
 *   - 'classify' : full move classification (fenBefore + fenAfter, does the
 *     CAPS2 math server-side)
 *   - 'eval'     : single-FEN evaluation (used by client-side fallback
 *     ServerAnalysisEngine)
 */

import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { redis } from './connection.js';
import { StockfishPool } from '../engine/StockfishPool.js';
import { ANALYSIS_DEPTH, getAnalysisConfig } from '../engine/StockfishConfig.js';

export type MoveClassification =
  | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface ClassifyJobData {
  kind: 'classify';
  requestId: string;
  userId: string;
  fenBefore: string;
  fenAfter: string;
  move: string;
  playerColor: 'white' | 'black';
}

export interface EvalJobData {
  kind: 'eval';
  requestId: string;
  userId: string;
  fen: string;
  depth?: number;
}

export type AnalysisJobData = ClassifyJobData | EvalJobData;

export interface ClassifyJobResult {
  kind: 'classify';
  move: string;
  classification: MoveClassification;
  caps2: number;
  diff: number;
  wpDiff: number;
  evalBefore: number;
  evalAfter: number;
  bestMove: string;
}

export interface EvalJobResult {
  kind: 'eval';
  evaluation: number;   // centipawns, side-to-move POV (matches client AnalysisEngine contract)
  bestMove: string;
  depth: number;
}

export type AnalysisJobResult = ClassifyJobResult | EvalJobResult;

// ─── Chess.com-calibrated formulas (same as chessr-next) ──────────────────

function winProb(evalPawns: number): number {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function classifyMove(bestEval: number, afterEval: number): MoveClassification {
  const wpDiff = Math.max(0, winProb(bestEval) - winProb(afterEval));
  if (wpDiff <= 0.001) return 'best';
  if (wpDiff <= 2) return 'excellent';
  if (wpDiff <= 5) return 'good';
  if (wpDiff <= 10) return 'inaccuracy';
  if (wpDiff <= 20) return 'mistake';
  return 'blunder';
}

function computeCAPS2(diff: number, absEval: number): number {
  if (diff <= 0) return 100;
  const raw = 100 * (1 - 0.50 * Math.pow(diff, 0.95) * (1 + 0.005 * Math.pow(absEval, 2.25)));
  return Math.max(0, Math.min(100, raw));
}

function normalizeEval(evalCp: number, playerColor: 'white' | 'black'): number {
  const evalPawns = evalCp / 100;
  return playerColor === 'white' ? evalPawns : -evalPawns;
}

// ─── Queue + Worker ────────────────────────────────────────────────────────

const QUEUE_NAME = 'analysis';

export const analysisQueue = new Queue<AnalysisJobData, AnalysisJobResult>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 100 },
  },
});

let queueEvents: QueueEvents | null = null;
let worker: Worker<AnalysisJobData, AnalysisJobResult> | null = null;
let pool: StockfishPool | null = null;

export async function initAnalysisWorker(maxInstances: number): Promise<void> {
  if (worker) return;

  pool = new StockfishPool(maxInstances);
  await pool.init();

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis });
  await queueEvents.waitUntilReady();

  worker = new Worker<AnalysisJobData, AnalysisJobResult>(
    QUEUE_NAME,
    async (job) => processAnalysisJob(job),
    { connection: redis, concurrency: maxInstances },
  );

  worker.on('failed', (job, err) => {
    console.error(`[AnalysisQueue] job ${job?.id} failed:`, err.message);
  });

  console.log(`[AnalysisQueue] worker ready (concurrency=${maxInstances})`);
}

async function processAnalysisJob(
  job: Job<AnalysisJobData, AnalysisJobResult>,
): Promise<AnalysisJobResult> {
  if (!pool) throw new Error('Stockfish pool not initialised');
  const engine = await pool.acquire();
  if (!engine) throw new Error('Stockfish pool unavailable');
  try {
    await engine.configure(getAnalysisConfig());

    if (job.data.kind === 'eval') {
      const { fen, depth } = job.data;
      const searchDepth = Math.max(1, Math.min(ANALYSIS_DEPTH, depth || ANALYSIS_DEPTH));
      const results = await engine.search(fen, 1, { depth: searchDepth });
      const top = results[0];
      // EngineManager.search returns WHITE-POV eval. Un-flip to side-to-move
      // POV to match the client AnalysisEngine.analyze() contract.
      const isBlackToMove = fen.split(' ')[1] === 'b';
      const rawEval = top?.evaluation ?? 0;
      return {
        kind: 'eval',
        evaluation: isBlackToMove ? -rawEval : rawEval,
        bestMove: top?.move ?? '',
        depth: searchDepth,
      };
    }

    // 'classify'
    const { fenBefore, fenAfter, move, playerColor } = job.data;
    const beforeResults = await engine.search(fenBefore, 1, { depth: ANALYSIS_DEPTH });
    const afterResults = await engine.search(fenAfter, 1, { depth: ANALYSIS_DEPTH });

    const bestRaw = beforeResults[0]?.evaluation ?? 0;
    const afterRaw = afterResults[0]?.evaluation ?? 0;
    const bestMove = beforeResults[0]?.move ?? move;

    const bestEval = normalizeEval(bestRaw, playerColor);
    const evalAfter = normalizeEval(afterRaw, playerColor);
    const diff = Math.max(0, bestEval - evalAfter);
    const wpDiff = Math.max(0, winProb(bestEval) - winProb(evalAfter));
    const caps2 = computeCAPS2(diff, Math.abs(bestEval));
    const classification = classifyMove(bestEval, evalAfter);

    return {
      kind: 'classify',
      move,
      classification,
      caps2: Math.round(caps2 * 10) / 10,
      diff: Math.round(diff * 100) / 100,
      wpDiff: Math.round(wpDiff * 100) / 100,
      evalBefore: Math.round(bestEval * 100) / 100,
      evalAfter: Math.round(evalAfter * 100) / 100,
      bestMove,
    };
  } finally {
    pool.release(engine);
  }
}

export async function enqueueClassify(data: ClassifyJobData): Promise<ClassifyJobResult> {
  if (!queueEvents) throw new Error('AnalysisQueue not initialised');
  const jobId = `cls:${data.userId}:${data.requestId}`;
  const job = await analysisQueue.add('process', data, { jobId });
  const result = await job.waitUntilFinished(queueEvents);
  if (result.kind !== 'classify') throw new Error(`Unexpected job result kind: ${result.kind}`);
  return result;
}

export async function enqueueEval(data: EvalJobData): Promise<EvalJobResult> {
  if (!queueEvents) throw new Error('AnalysisQueue not initialised');
  const jobId = `evl:${data.userId}:${data.requestId}`;
  const job = await analysisQueue.add('process', data, { jobId });
  const result = await job.waitUntilFinished(queueEvents);
  if (result.kind !== 'eval') throw new Error(`Unexpected job result kind: ${result.kind}`);
  return result;
}

export async function removePendingAnalysisForUser(userId: string): Promise<number> {
  const waiting = await analysisQueue.getWaiting(0, 100);
  let removed = 0;
  for (const job of waiting) {
    if (job.data.userId === userId) {
      try { await job.remove(); removed++; } catch { /* race */ }
    }
  }
  return removed;
}

export async function shutdownAnalysisWorker(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (worker) tasks.push(worker.close());
  if (queueEvents) tasks.push(queueEvents.close());
  if (pool) tasks.push(pool.shutdown());
  await Promise.allSettled(tasks);
  worker = null;
  queueEvents = null;
  pool = null;
}
