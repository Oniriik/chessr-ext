/**
 * Analytics endpoints — time-bucketed aggregates over user_activity for
 * the dashboard's /analytics page. Reads only the local-pg analytics DB.
 *
 * Bucket sizing is driven from the range so we never return more than
 * ~200 points per series (recharts gets slow past that on phones).
 *
 *   <= 48h  → 1h buckets   (max 48 points)
 *   <= 14d  → 4h buckets   (max 84 points)
 *   <= 31d  → 1d buckets   (max 31 points)
 *   <= 180d → 1d buckets   (max 180 points)
 *   else    → 7d buckets
 *
 * Endpoint:
 *   GET /admin/analytics/series?from=<iso>&to=<iso>
 *     → { bucket, from, to, series: { ... } }
 *
 * Auth: x-admin-token (matches the rest of /admin/*).
 *
 * Query coverage by existing indexes:
 *   - user_activity_event_engine_source_time_idx (event_type, engine,
 *     source, created_at DESC)  ← suggestionsByEngine, eventMix
 *   - user_activity_time_event_idx (created_at DESC, event_type)
 *     ← gameReviews, profileAnalyses, activeUsers
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';
import { supabase } from '../lib/supabase.js';

export const adminAnalyticsRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

interface BucketChoice {
  /** Postgres date_trunc unit ('minute' | 'hour' | 'day' | 'week') — only
   *  used when secondsBucket is unset. */
  truncUnit: 'minute' | 'hour' | 'day' | 'week';
  /** Step size in ms — used client-side to fill gaps if needed. */
  stepMs: number;
  /** Human label for the response payload. */
  label: '5m' | '15m' | '1h' | '4h' | '1d' | '7d';
  /** When set, we bucket by floor(epoch / secondsBucket) instead of
   *  date_trunc. Needed for non-native intervals (5m, 15m, 4h). */
  secondsBucket?: number;
}

function pickBucket(rangeMs: number): BucketChoice {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (rangeMs <= 2 * HOUR)  return { truncUnit: 'minute', stepMs: 5 * MIN, label: '5m', secondsBucket: 5 * 60 };
  if (rangeMs <= 8 * HOUR)  return { truncUnit: 'minute', stepMs: 15 * MIN, label: '15m', secondsBucket: 15 * 60 };
  if (rangeMs <= 48 * HOUR) return { truncUnit: 'hour', stepMs: HOUR, label: '1h' };
  if (rangeMs <= 14 * DAY)  return { truncUnit: 'hour', stepMs: 4 * HOUR, label: '4h', secondsBucket: 4 * 3600 };
  if (rangeMs <= 180 * DAY) return { truncUnit: 'day',  stepMs: DAY, label: '1d' };
  return { truncUnit: 'week', stepMs: 7 * DAY, label: '7d' };
}

function parseRange(c: Context): { from: Date; to: Date } | null {
  const u = new URL(c.req.url);
  const fromStr = u.searchParams.get('from');
  const toStr   = u.searchParams.get('to');
  if (!fromStr || !toStr) return null;
  const from = new Date(fromStr);
  const to   = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from >= to) return null;
  return { from, to };
}

// Compose the bucket SQL expression. For non-native intervals (5m / 15m
// / 4h) we floor the epoch via integer math since date_trunc has no
// matching unit.
function bucketExpr(b: BucketChoice): string {
  if (b.secondsBucket) {
    return `to_timestamp(
              floor(extract(epoch from created_at) / ${b.secondsBucket})
              * ${b.secondsBucket}
            ) AT TIME ZONE 'UTC'`;
  }
  return `date_trunc('${b.truncUnit}', created_at)`;
}

// ─── GET /admin/analytics/totals — all-time counters ───────────────────
// Cheap aggregate query used by the Discord stats voice channels and
// the dashboard's overview tiles. No filter on time — just COUNT(*)
// over user_activity by event_type. Caller can divide / format
// however it wants.

adminAnalyticsRoutes.get('/admin/analytics/totals', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const rows = await dbQuery<{ event_type: string; count: string }>(
    `SELECT event_type, COUNT(*)::text AS count
       FROM user_activity
      GROUP BY 1`,
  );
  const totals: Record<string, number> = {
    suggestion: 0, analysis: 0, explanation: 0,
    game_review: 0, profile_analysis: 0,
  };
  for (const r of rows) totals[r.event_type] = Number(r.count);
  return c.json({ totals });
});

adminAnalyticsRoutes.get('/admin/analytics/series', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const range = parseRange(c);
  if (!range) return c.json({ error: 'from and to ISO timestamps required (from < to)' }, 400);

  const bucket = pickBucket(range.to.getTime() - range.from.getTime());
  const bSql = bucketExpr(bucket);
  const fromIso = range.from.toISOString();
  const toIso   = range.to.toISOString();

  // ─── Suggestions by engine ─────────────────────────────────────────
  // 'analysis' rows also carry an engine column but we keep suggestions
  // (the actual move-picking event) since that's what the user asked
  // for. Tweak the WHERE here if "ended" should include analysis too.
  const suggestionsRaw = await dbQuery<{ t: string; engine: string; count: string }>(
    `SELECT ${bSql} AS t, COALESCE(engine, 'unknown') AS engine, COUNT(*)::text AS count
       FROM user_activity
      WHERE event_type = 'suggestion'
        AND created_at >= $1
        AND created_at <  $2
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [fromIso, toIso],
  );

  // ─── Active users (distinct) per bucket ────────────────────────────
  const activeUsersRaw = await dbQuery<{ t: string; count: string }>(
    `SELECT ${bSql} AS t, COUNT(DISTINCT user_id)::text AS count
       FROM user_activity
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1
      ORDER BY 1`,
    [fromIso, toIso],
  );

  // ─── Game reviews ──────────────────────────────────────────────────
  // Split by acquisition channel: the chess.com review handler tags
  // every event with metadata.source — 'app' (web app), 'unlocker'
  // (standalone Review Unlocker extension), or null/other (older
  // events from the main extension before tagging was added).
  const gameReviewsRaw = await dbQuery<{ t: string; source: string; count: string }>(
    `SELECT ${bSql} AS t,
            COALESCE(metadata->>'source', 'other') AS source,
            COUNT(*)::text AS count
       FROM user_activity
      WHERE event_type = 'game_review'
        AND created_at >= $1 AND created_at < $2
      GROUP BY 1, 2
      ORDER BY 1`,
    [fromIso, toIso],
  );

  // ─── Profile analyses ──────────────────────────────────────────────
  const profileAnalysesRaw = await dbQuery<{ t: string; count: string }>(
    `SELECT ${bSql} AS t, COUNT(*)::text AS count
       FROM user_activity
      WHERE event_type = 'profile_analysis'
        AND created_at >= $1 AND created_at < $2
      GROUP BY 1
      ORDER BY 1`,
    [fromIso, toIso],
  );

  // ─── Source split (server vs wasm) for suggestions overall ────────
  const sourceSplitRaw = await dbQuery<{ source: string; count: string }>(
    `SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::text AS count
       FROM user_activity
      WHERE event_type IN ('suggestion', 'analysis')
        AND created_at >= $1 AND created_at < $2
      GROUP BY 1`,
    [fromIso, toIso],
  );

  // ─── Per-engine source split — same data as the overall split but
  // grouped per engine so the dashboard can render a stacked bar with
  // one column per engine showing how WASM-heavy each one is.
  const engineSourceRaw = await dbQuery<{ engine: string; source: string; count: string }>(
    `SELECT COALESCE(engine, 'unknown') AS engine,
            COALESCE(source, 'unknown') AS source,
            COUNT(*)::text AS count
       FROM user_activity
      WHERE event_type IN ('suggestion', 'analysis')
        AND created_at >= $1 AND created_at < $2
        AND engine IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [fromIso, toIso],
  );

  // Pivot engine×source into one row per engine with server/wasm cols.
  const engineSourceMap = new Map<string, { engine: string; server: number; wasm: number; unknown: number; total: number }>();
  for (const r of engineSourceRaw) {
    if (!engineSourceMap.has(r.engine)) {
      engineSourceMap.set(r.engine, { engine: r.engine, server: 0, wasm: 0, unknown: 0, total: 0 });
    }
    const row = engineSourceMap.get(r.engine)!;
    const n = Number(r.count);
    if (r.source === 'server') row.server = n;
    else if (r.source === 'wasm') row.wasm = n;
    else row.unknown = n;
    row.total += n;
  }
  const engineSource = Array.from(engineSourceMap.values()).sort((a, b) => b.total - a.total);

  // ─── Bonus: event mix overview ─────────────────────────────────────
  const eventMixRaw = await dbQuery<{ event_type: string; count: string }>(
    `SELECT event_type, COUNT(*)::text AS count
       FROM user_activity
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1
      ORDER BY 2 DESC`,
    [fromIso, toIso],
  );

  // ─── New signups per bucket — sourced from Supabase user_settings.
  // We pull just the created_at column, then bucket client-side. For
  // ranges past ~6 months this is ~5K rows max so the round-trip is
  // negligible. Supabase user_settings has an index on user_id only,
  // but the table is small enough that the seq scan + filter is fine.
  const signupsByBucket: Array<{ t: string; count: number }> = [];
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('created_at')
      .gte('created_at', fromIso)
      .lt('created_at', toIso);
    if (data && data.length > 0) {
      // Bucket signups locally — Supabase has no easy date_trunc API.
      const counts = new Map<number, number>();
      const stepMs = bucket.stepMs;
      for (const row of data) {
        const ts = new Date(row.created_at as string).getTime();
        const floored = Math.floor(ts / stepMs) * stepMs;
        counts.set(floored, (counts.get(floored) || 0) + 1);
      }
      for (const [ms, count] of Array.from(counts.entries()).sort((a, b) => a[0] - b[0])) {
        signupsByBucket.push({ t: new Date(ms).toISOString(), count });
      }
    }
  } catch (err) {
    console.warn('[analytics] signups query failed:', err);
  }

  // ─── Free trials started per bucket — freetrial_claimed events (local
  // events table, covers both the Discord auto-claim and the direct
  // /freetrial/claim path).
  let freetrialsByBucket: Array<{ t: string; count: number }> = [];
  try {
    const rows = await dbQuery<{ t: string; count: string }>(
      `SELECT ${bSql.replace(/created_at/g, 'created_at')} AS t, COUNT(*)::text AS count
         FROM events
        WHERE type = 'freetrial_claimed'
          AND created_at >= $1
          AND created_at <  $2
        GROUP BY 1
        ORDER BY 1`,
      [fromIso, toIso],
    );
    freetrialsByBucket = rows.map((r) => ({ t: new Date(r.t).toISOString(), count: Number(r.count) }));
  } catch (err) {
    console.warn('[analytics] freetrials query failed:', err);
  }

  // Pivot suggestionsRaw into one row per bucket with engines as cols.
  const engines = new Set<string>();
  for (const r of suggestionsRaw) engines.add(r.engine);
  const sugByT = new Map<string, Record<string, number>>();
  for (const r of suggestionsRaw) {
    const key = new Date(r.t).toISOString();
    if (!sugByT.has(key)) sugByT.set(key, {});
    sugByT.get(key)![r.engine] = Number(r.count);
  }
  const suggestionsByEngine = Array.from(sugByT.entries())
    .map(([t, byEng]) => ({ t, ...byEng }))
    .sort((a, b) => a.t.localeCompare(b.t));

  return c.json({
    from: fromIso,
    to: toIso,
    bucket: bucket.label,
    stepMs: bucket.stepMs,
    engines: Array.from(engines).sort(),
    series: {
      suggestionsByEngine,
      activeUsers: activeUsersRaw.map((r) => ({
        t: new Date(r.t).toISOString(),
        count: Number(r.count),
      })),
      gameReviews: (() => {
        // Pivot { t, source, count } → one row per bucket with
        // app/unlocker/extension/other columns plus a total `count`
        // so the dashboard's stat tile keeps its single-number sum.
        const byT = new Map<string, { t: string; app: number; unlocker: number; extension: number; other: number; count: number }>();
        for (const r of gameReviewsRaw) {
          const t = new Date(r.t).toISOString();
          if (!byT.has(t)) byT.set(t, { t, app: 0, unlocker: 0, extension: 0, other: 0, count: 0 });
          const row = byT.get(t)!;
          const n = Number(r.count);
          if (r.source === 'app') row.app = n;
          else if (r.source === 'unlocker') row.unlocker = n;
          else if (r.source === 'extension') row.extension = n;
          else row.other = n;
          row.count += n;
        }
        return Array.from(byT.values()).sort((a, b) => a.t.localeCompare(b.t));
      })(),
      profileAnalyses: profileAnalysesRaw.map((r) => ({
        t: new Date(r.t).toISOString(),
        count: Number(r.count),
      })),
      sourceSplit: sourceSplitRaw.map((r) => ({
        source: r.source,
        count: Number(r.count),
      })),
      engineSource,
      eventMix: eventMixRaw.map((r) => ({
        event_type: r.event_type,
        count: Number(r.count),
      })),
      signups: signupsByBucket,
      freetrials: freetrialsByBucket,
    },
  });
});
