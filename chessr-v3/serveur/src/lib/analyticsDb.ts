/**
 * Analytics DB client — local Postgres holding the heavy event tables
 * (user_activity, game_reviews) that we offloaded from Supabase to stay
 * under the 500 MB free tier.
 *
 * Wired through a feature flag (USE_LOCAL_ANALYTICS) so we can flip
 * traffic between Supabase and the local DB without redeploying. Until
 * the migration is validated, the flag stays false and writes/reads
 * keep going to Supabase via the existing supabase client. Once the
 * data is copied over and the flag flips to true, every consumer in
 * this codebase that imports `analyticsDb` reads/writes from local.
 *
 * The pool is lazily constructed: if USE_LOCAL_ANALYTICS=false (the
 * default) we never spin it up — no wasted connections, no startup
 * crash if ANALYTICS_DATABASE_URL is unset on a host that doesn't run
 * the postgres-analytics container.
 */
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isLocalAnalyticsEnabled(): boolean {
  return process.env.USE_LOCAL_ANALYTICS === 'true';
}

export function getAnalyticsPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.ANALYTICS_DATABASE_URL;
  if (!url) {
    throw new Error(
      'ANALYTICS_DATABASE_URL is not set — required when USE_LOCAL_ANALYTICS=true',
    );
  }
  pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => {
    // Idle-client errors (network blip, pg restart). Pool retries on
    // the next checkout; just log so we notice.
    console.error('[analyticsDb] idle client error:', err.message);
  });
  return pool;
}

/** Convenience: parametrised query against the analytics DB. Returns
 *  the rows array (caller doesn't usually care about the rest of the
 *  pg.QueryResult). */
export async function analyticsQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getAnalyticsPool().query<T>(text, params as never[]);
  return result.rows;
}

/** Graceful shutdown — call from the server's stop hook so in-flight
 *  queries drain before exit. */
export async function closeAnalyticsPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
