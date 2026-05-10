/**
 * In-process cron registry for the serveur. Used for any periodic work
 * that doesn't need a separate worker process: giveaway draw + announce,
 * elo refresh of linked accounts, future cleanup jobs, etc.
 *
 * Pattern:
 *   1. Each job lives in src/jobs/<name>.ts and exports a `run()` async
 *      function. Jobs MUST be idempotent and tolerant of overlapping
 *      runs being skipped (we drop a tick when the previous one is
 *      still running).
 *   2. Register the job at boot via registerCron(...).
 *   3. Call startCrons() once after all routes are wired.
 *
 * Failure is contained: a job throwing doesn't kill the process or stop
 * the timer — the next tick fires normally.
 *
 * Multi-replica: if the serveur ever runs in multiple replicas, jobs
 * must use FOR UPDATE SKIP LOCKED or a similar guard themselves.
 * `runImmediately` only runs in the local process, so two replicas
 * with the same job will both fire — not an issue when jobs are
 * idempotent / row-locked.
 */

interface CronJob {
  name: string;
  intervalMs: number;
  /** When true, run once 5s after startCrons() (lets boot finish
   *  first). Default false → first run after intervalMs. */
  runImmediately?: boolean;
  run: () => Promise<void>;
}

const jobs: CronJob[] = [];
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();

export function registerCron(job: CronJob): void {
  if (job.intervalMs < 1_000) {
    throw new Error(`cron job "${job.name}" intervalMs ${job.intervalMs} too low (min 1000ms)`);
  }
  jobs.push(job);
}

export function startCrons(): void {
  for (const job of jobs) {
    console.info(`[cron] scheduling "${job.name}" every ${(job.intervalMs / 1000).toFixed(0)}s`);
    if (job.runImmediately) {
      setTimeout(() => { void runWithCatch(job); }, 5_000);
    }
    const timer = setInterval(() => { void runWithCatch(job); }, job.intervalMs);
    timers.set(job.name, timer);
  }
}

export function stopCrons(): void {
  for (const [name, timer] of timers) {
    clearInterval(timer);
    console.info(`[cron] stopped "${name}"`);
  }
  timers.clear();
}

async function runWithCatch(job: CronJob): Promise<void> {
  // Skip if a previous tick is still running. Avoids a slow job
  // running multiple times in parallel.
  if (running.has(job.name)) {
    console.warn(`[cron] "${job.name}" still running, skipping tick`);
    return;
  }
  running.add(job.name);
  const start = Date.now();
  try {
    await job.run();
    const ms = Date.now() - start;
    if (ms > 1_000) console.info(`[cron] "${job.name}" ok (${ms}ms)`);
  } catch (err) {
    console.error(`[cron] "${job.name}" failed:`, err);
  } finally {
    running.delete(job.name);
  }
}
