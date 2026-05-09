/**
 * Local Postgres pool — single connection used by everything that
 * persists outside Supabase. Originally introduced for the analytics
 * tables (user_activity, game_reviews) that we offloaded from Supabase
 * to stay under the 500 MB free tier; now also holds the events log
 * (and whatever new append-only / high-volume tables land here next).
 *
 * Wired through a feature flag (USE_LOCAL_DB) so we can flip traffic
 * between Supabase and the local DB for the *analytics* tables that
 * predate this; the events table is local-only and ignores the flag.
 *
 * The pool is lazily constructed: if USE_LOCAL_DB=false on a host that
 * doesn't run the postgres container, we never spin it up — no wasted
 * connections, no startup crash if LOCAL_DATABASE_URL is unset.
 */
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isLocalDbEnabled(): boolean {
  return process.env.USE_LOCAL_DB === 'true';
}

export function getDbPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.LOCAL_DATABASE_URL;
  if (!url) {
    throw new Error(
      'LOCAL_DATABASE_URL is not set — required to talk to the local Postgres',
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
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

/** Convenience: parametrised query against the local DB. Returns the
 *  rows array (caller doesn't usually care about the rest of the
 *  pg.QueryResult). */
export async function dbQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getDbPool().query<T>(text, params as never[]);
  return result.rows;
}

/** Graceful shutdown — call from the server's stop hook so in-flight
 *  queries drain before exit. */
export async function closeDbPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
