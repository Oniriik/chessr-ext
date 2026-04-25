/**
 * BullMQ suggestion queue.
 *
 * Replaces the in-memory SuggestionQueue class. Producer = WS handler that
 * calls `enqueueSuggestion(...)` and awaits the result via QueueEvents.
 * Consumer = Worker that acquires an engine from the in-process EnginePool,
 * runs the UCI search, and returns the result.
 *
 * Supersede-per-user semantics (old requests from the same user dropped when
 * a new one comes in) is preserved via `removePendingSuggestionsForUser()`
 * — called by the handler before enqueueing and on disconnect.
 */

import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { redis } from './connection.js';
import { EnginePool } from '../engine/EnginePool.js';
import { labelSuggestions, type LabeledSuggestion } from '../engine/MoveLabeler.js';

export interface SuggestionJobData {
  requestId: string;
  userId: string;
  fen: string;
  pvCount: number;
  config: Record<string, string>;
  searchOptions: {
    nodes?: number;
    depth?: number;
    movetime?: number;
    moves?: string[];
  };
  personality: string;
  puzzleMode: boolean;
}

export interface SuggestionJobResult {
  fen: string;
  personality: string;
  suggestions: LabeledSuggestion[];
  positionEval: number;
  mateIn: number | null;
  winRate: number;
  puzzleMode: boolean;
  maxDepth: number;
}

const QUEUE_NAME = 'komodo';

/** Hard cap on one producer-side wait. Must be ≥ the engine's internal
 *  search timeout (30 s in EngineManager) plus a small queueing slack.
 *  If the cap fires, the client gets `suggestion_error: 'timeout'` and the
 *  orphan job finishes harmlessly in the background. */
const PRODUCER_TIMEOUT_MS = 35_000;

/** Worker-side lock on an in-flight job. Must be > the engine's internal
 *  30 s search timeout, otherwise BullMQ would consider a long search
 *  stalled and re-queue it (which would cost a duplicate search). */
const LOCK_DURATION_MS = 45_000;

export const suggestionQueue = new Queue<SuggestionJobData, SuggestionJobResult>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 100 },
    attempts: 1,              // no auto-retry: a failed search is final
  },
});

let queueEvents: QueueEvents | null = null;
let worker: Worker<SuggestionJobData, SuggestionJobResult> | null = null;
let pool: EnginePool | null = null;

export async function initSuggestionWorker(maxInstances: number): Promise<void> {
  if (worker) return;

  pool = new EnginePool(maxInstances);
  await pool.init();

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis });
  await queueEvents.waitUntilReady();

  worker = new Worker<SuggestionJobData, SuggestionJobResult>(
    QUEUE_NAME,
    async (job) => processSuggestionJob(job),
    {
      connection: redis,
      concurrency: maxInstances,
      lockDuration: LOCK_DURATION_MS,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[SuggestionQueue] job ${job?.id} failed:`, err.message);
  });

  console.log(`[SuggestionQueue] worker ready (concurrency=${maxInstances})`);
}

async function processSuggestionJob(
  job: Job<SuggestionJobData, SuggestionJobResult>,
): Promise<SuggestionJobResult> {
  if (!pool) throw new Error('Engine pool not initialised');
  const { fen, pvCount, config, searchOptions, personality, puzzleMode } = job.data;

  const engine = await pool.acquire();
  if (!engine) throw new Error('Engine pool unavailable');
  try {
    await engine.configure(config);
    const raw = await engine.search(fen, pvCount, searchOptions);
    const suggestions = labelSuggestions(raw);
    const positionEval = suggestions.length > 0 ? suggestions[0].evaluation / 100 : 0;
    const mateIn = suggestions.length > 0 ? suggestions[0].mateScore : null;
    const winRate = suggestions.length > 0 ? suggestions[0].winRate : 50;
    const maxDepth = suggestions.length > 0 ? Math.max(...suggestions.map((s) => s.depth)) : 0;
    return {
      fen,
      personality,
      suggestions,
      positionEval,
      mateIn,
      winRate,
      puzzleMode,
      maxDepth,
    };
  } finally {
    pool.release(engine);
  }
}

/**
 * Enqueue + await result. Concurrency throttled by the Worker — when N
 * workers are busy new jobs wait in Redis.
 */
export async function enqueueSuggestion(data: SuggestionJobData): Promise<SuggestionJobResult> {
  if (!queueEvents) throw new Error('SuggestionQueue not initialised');
  const jobId = `sug:${data.userId}:${data.requestId}`;
  const job = await suggestionQueue.add('process', data, { jobId });
  // waitUntilFinished(queueEvents, ttl) rejects with "Timed out after X ms"
  // after the cap. The underlying job keeps running but its result is
  // discarded — the engine gets released normally.
  return job.waitUntilFinished(queueEvents, PRODUCER_TIMEOUT_MS);
}

/**
 * Drop any *waiting* job from this user. Jobs already in 'active' state
 * can't be safely cancelled mid-UCI; they finish then the handler's
 * requestId check discards the stale reply on its own.
 */
export async function removePendingSuggestionsForUser(userId: string): Promise<number> {
  const waiting = await suggestionQueue.getWaiting(0, 100);
  let removed = 0;
  for (const job of waiting) {
    if (job.data.userId === userId) {
      try { await job.remove(); removed++; } catch { /* race — already gone */ }
    }
  }
  return removed;
}

export async function shutdownSuggestionWorker(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (worker) tasks.push(worker.close());
  if (queueEvents) tasks.push(queueEvents.close());
  if (pool) tasks.push(pool.shutdown());
  await Promise.allSettled(tasks);
  worker = null;
  queueEvents = null;
  pool = null;
}
