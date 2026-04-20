import { Queue, Worker, type Job } from 'bullmq';
import { redis } from './redis.js';
import type { SearchOptions } from '../engine/searchOptions.js';

const PREFIX = 'chessr';

export interface SuggestionJob {
  requestId: string;
  userId: string;
  fen: string;
  moves: string[];
  targetElo: number;
  personality: string;
  multiPv: number;
  limitStrength: boolean;
  search?: SearchOptions;
}

export interface SuggestionResult {
  requestId: string;
  fen: string;
  suggestions: {
    move: string;
    evaluation: number;
    winRate: number;
    drawRate: number;
    lossRate: number;
    depth: number;
    mateScore: number | null;
    pv: string[];
    label: string;
  }[];
}

export const suggestionQueue = new Queue<SuggestionJob>(
  'suggestions',
  { connection: redis, prefix: PREFIX },
);

export function startSuggestionWorker(
  processor: (job: Job<SuggestionJob>) => Promise<SuggestionResult>,
) {
  const worker = new Worker<SuggestionJob, SuggestionResult>(
    'suggestions',
    processor,
    { connection: redis, prefix: PREFIX, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    const d = job?.data;
    if (!d) {
      console.error(`[Queue] Job ${job?.id} failed: ${err.message}`);
      return;
    }
    const searchDesc = d.search
      ? `${d.search.mode}:${d.search.nodes ?? d.search.depth ?? d.search.movetime}`
      : 'default';
    console.error(
      `[Queue] Job ${job.id} failed: ${err.message} ` +
        `userId=${d.userId} req=${d.requestId} ` +
        `elo=${d.targetElo} mpv=${d.multiPv} limitStr=${d.limitStrength} ` +
        `search=${searchDesc} moves=${d.moves?.length ?? 0} ` +
        `fen="${d.fen}"`,
    );
  });

  return worker;
}
