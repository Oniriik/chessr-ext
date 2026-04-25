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

const STATS_INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function snapshot(): Promise<void> {
  try {
    const [sug, ana, mai] = await Promise.all([
      suggestionQueue.getJobCounts('active', 'waiting', 'completed', 'failed'),
      analysisQueue.getJobCounts('active', 'waiting', 'completed', 'failed'),
      maiaQueue.getJobCounts('active', 'waiting', 'completed', 'failed'),
    ]);
    console.log(
      `[Queues] ` +
      `sug active=${sug.active} waiting=${sug.waiting} done=${sug.completed} failed=${sug.failed} ; ` +
      `ana active=${ana.active} waiting=${ana.waiting} done=${ana.completed} failed=${ana.failed} ; ` +
      `mai active=${mai.active} waiting=${mai.waiting} done=${mai.completed} failed=${mai.failed}`,
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
