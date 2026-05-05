/**
 * Analytics repo — single point of truth for reads/writes against the
 * heavy event tables (`user_activity`, `game_reviews`). Each function
 * routes to either Supabase (legacy, default) or the local Postgres
 * (`analyticsDb`) depending on USE_LOCAL_ANALYTICS.
 *
 * Call sites in routes/handlers stay clean — they call e.g.
 * `countUserActivityToday(userId, 'explanation')` instead of doing the
 * supabase/pg branching themselves. This keeps the eventual cleanup
 * (post-migration: drop the supabase branch) to a single file.
 */
import { supabase } from './supabase.js';
import { analyticsQuery, isLocalAnalyticsEnabled } from './analyticsDb.js';

// ─── user_activity ────────────────────────────────────────────────────────

/** Count today's events of a given type for one user. Used to enforce
 *  daily free-tier limits in explanation.ts and chesscomReview.ts. */
export async function countUserActivityToday(
  userId: string,
  eventType: string,
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

/** Append a user_activity row. Fire-and-forget at call sites — caller
 *  owns the try/catch policy (explanation.ts surfaces errors, the
 *  chesscomReview.ts logger swallows them). */
export async function insertUserActivity(
  userId: string,
  eventType: string,
): Promise<void> {
  if (isLocalAnalyticsEnabled()) {
    await analyticsQuery(
      `INSERT INTO user_activity (user_id, event_type) VALUES ($1, $2::activity_event_type)`,
      [userId, eventType],
    );
    return;
  }
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
