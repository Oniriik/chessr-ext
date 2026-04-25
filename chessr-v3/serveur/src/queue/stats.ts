/**
 * Periodic snapshot of BullMQ queue + worker depth, dumped to console every
 * STATS_INTERVAL_MS so the admin dashboard / docker logs can chart it.
 *
 * Format (single line, easy to grep):
 *   [Queues] sug active=2 waiting=15 ; ana active=0 waiting=3
 */

import { suggestionQueue } from './suggestionQueue.js';
import { analysisQueue } from './analysisQueue.js';
import { maiaQueue } from './maiaQueue.js';
import { maia3Queue } from './maia3Queue.js';

const STATS_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function snapshot(): Promise<void> {
  try {
    const [sug, ana, mai, mai3] = await Promise.all([
      suggestionQueue.getJobCounts('active', 'waiting', 'completed', 'failed'),
      analysisQueue.getJobCounts('active', 'waiting', 'completed', 'failed'),
      maiaQueue.getJobCounts('active', 'waiting', 'completed', 'failed'),
      maia3Queue.getJobCounts('active', 'waiting', 'completed', 'failed'),
    ]);
    console.log(
      `[Queues] ` +
      `komodo active=${sug.active} waiting=${sug.waiting} done=${sug.completed} failed=${sug.failed} ; ` +
      `analysis active=${ana.active} waiting=${ana.waiting} done=${ana.completed} failed=${ana.failed} ; ` +
      `maia-2 active=${mai.active} waiting=${mai.waiting} done=${mai.completed} failed=${mai.failed} ; ` +
      `maia-3 active=${mai3.active} waiting=${mai3.waiting} done=${mai3.completed} failed=${mai3.failed}`,
    );
  } catch (err) {
    console.warn('[Queues] stats snapshot failed:', err instanceof Error ? err.message : err);
  }
}

export function startQueueStats(): void {
  if (timer) return;
  // First snapshot after 5s so boot output isn't drowned, then every 30s.
  setTimeout(() => {
    snapshot();
    timer = setInterval(snapshot, STATS_INTERVAL_MS);
  }, 5000);
}

export function stopQueueStats(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
