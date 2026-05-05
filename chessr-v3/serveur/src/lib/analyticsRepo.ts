/**
 * Analytics repo — single point of truth for reads/writes against the
 * heavy event tables (`user_activity`, `game_reviews`). Each function
 * routes to either Supabase (legacy, default) or the local Postgres
 * (`analyticsDb`) depending on USE_LOCAL_ANALYTICS.
 *
 * Schema versions:
 *   - Supabase (legacy):  user_activity has only (id, user_id, event_type, created_at).
 *   - Local Postgres:     user_activity has the same + (engine, source, metadata)
 *                          for richer breakdowns (see 00002_event_dims.sql).
 *
 * The flag toggles BOTH location and format together — when false, writes
 * land on Supabase with the legacy two-column shape; engine / source /
 * metadata are silently dropped (their columns don't exist there). When
 * true, writes land on local Postgres and carry the full dimensions.
 *
 * This is intentional: there's no point writing dimensions we couldn't
 * read back when on Supabase, and dual-shape writers add complexity for
 * no benefit during the short transition window.
 */
import { supabase } from './supabase.js';
import { analyticsQuery, isLocalAnalyticsEnabled } from './analyticsDb.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'suggestion'
  | 'analysis'
  | 'explanation'
  | 'game_review'
  | 'profile_analysis'
  // 'maia_suggestion' is deprecated — collapsed into 'suggestion' with
  // engine='maia2'. Kept in the local DB enum for backward-compat reads
  // of pre-migration rows; never emitted by new code.
  ;

export type EngineId = 'komodo' | 'maia2' | 'maia3' | 'stockfish';
export type EventSource = 'server' | 'wasm';

export interface UserActivityInsert {
  userId: string;
  eventType: ActivityEventType;
  /** Engine that did the work — only for `suggestion` and `analysis`.
   *  Leave undefined for explanation / game_review / profile_analysis. */
  engine?: EngineId;
  /** Where the engine ran — only for `suggestion` and `analysis`. */
  source?: EventSource;
  /** Free-form per-event extras: model name (explanation), coach_id +
   *  platform (game_review), platform (profile_analysis), etc. */
  metadata?: Record<string, unknown>;
}

// ─── user_activity ────────────────────────────────────────────────────────

/** Count today's events of a given type for one user. Used to enforce
 *  daily free-tier limits in explanation.ts and chesscomReview.ts. */
export async function countUserActivityToday(
  userId: string,
  eventType: ActivityEventType,
): Promise<number> {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const sinceISO = todayUTC.toISOString();

  if (isLocalAnalyticsEnabled()) {
    const rows = await analyticsQuery<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM user_activity
       WHERE user_id = $1 AND event_type = $2::activity_event_type AND created_at >= $3`,
      [userId, eventType, sinceISO],
    );
    return Number(rows[0]?.count ?? 0);
  }

  const { count } = await supabase
    .from('user_activity')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .gte('created_at', sinceISO);
  return count ?? 0;
}

/** Append a user_activity row. Caller owns the try/catch policy. */
export async function insertUserActivity(input: UserActivityInsert): Promise<void> {
  const { userId, eventType, engine, source, metadata } = input;

  if (isLocalAnalyticsEnabled()) {
    await analyticsQuery(
      `INSERT INTO user_activity (user_id, event_type, engine, source, metadata)
       VALUES ($1, $2::activity_event_type, $3, $4, $5::jsonb)`,
      [
        userId,
        eventType,
        engine ?? null,
        source ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    return;
  }

  // Supabase legacy path — engine/source/metadata don't exist there, drop
  // them. Stays compatible with the chessr-next dashboard which only knows
  // the two-column shape.
  await supabase.from('user_activity').insert({ user_id: userId, event_type: eventType });
}

// ─── game_reviews ─────────────────────────────────────────────────────────

export interface CachedReview {
  analysis: unknown;
  white_username: string | null;
  black_username: string | null;
}

/** Cache lookup for a chess.com review. Returns null on miss. */
export async function getCachedReview(
  gameId: string,
  platform: string,
  coachId: string,
): Promise<CachedReview | null> {
  if (isLocalAnalyticsEnabled()) {
    const rows = await analyticsQuery<CachedReview>(
      `SELECT analysis, white_username, black_username
       FROM game_reviews
       WHERE game_id = $1 AND platform = $2 AND coach_id = $3
       LIMIT 1`,
      [gameId, platform, coachId],
    );
    return rows[0] ?? null;
  }

  const { data } = await supabase
    .from('game_reviews')
    .select('analysis, white_username, black_username')
    .eq('game_id', gameId)
    .eq('platform', platform)
    .eq('coach_id', coachId)
    .single();
  return data ?? null;
}

export interface ReviewUpsertInput {
  game_id: string;
  platform: string;
  coach_id: string;
  analysis: unknown;
  caps_white: number | null;
  caps_black: number | null;
  white_username: string | null;
  black_username: string | null;
}

/** Cache insert/update for a chess.com review. Conflict on
 *  (game_id, platform, coach_id) overwrites the existing row. */
export async function upsertCachedReview(input: ReviewUpsertInput): Promise<void> {
  if (isLocalAnalyticsEnabled()) {
    await analyticsQuery(
      `INSERT INTO game_reviews (
         game_id, platform, coach_id, analysis,
         caps_white, caps_black, white_username, black_username
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
       ON CONFLICT (game_id, platform, coach_id) DO UPDATE SET
         analysis = EXCLUDED.analysis,
         caps_white = EXCLUDED.caps_white,
         caps_black = EXCLUDED.caps_black,
         white_username = EXCLUDED.white_username,
         black_username = EXCLUDED.black_username`,
      [
        input.game_id,
        input.platform,
        input.coach_id,
        JSON.stringify(input.analysis),
        input.caps_white,
        input.caps_black,
        input.white_username,
        input.black_username,
      ],
    );
    return;
  }

  await supabase.from('game_reviews').upsert(input, {
    onConflict: 'game_id,platform,coach_id',
  });
}
