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
    console.error(`[Queue] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
