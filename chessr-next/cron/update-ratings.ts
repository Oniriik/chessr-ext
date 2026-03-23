/**
 * Update Ratings (staleness-based)
 * Each run fetches up to BATCH_SIZE accounts whose ratings haven't been
 * updated in the last 30 minutes, ordered by oldest first.
 * Runs every minute via cron, so stale accounts are picked up quickly.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BATCH_SIZE = 25;
const RATE_LIMIT_MS = 500;
const STALE_MINUTES = 15;

async function fetchChesscomRatings(username: string) {
  const res = await fetch(
    `https://api.chess.com/pub/player/${username}/stats`,
    { headers: { 'User-Agent': 'Chessr.io Rating Updater' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    bullet: data.chess_bullet?.last?.rating ?? null,
    blitz: data.chess_blitz?.last?.rating ?? null,
    rapid: data.chess_rapid?.last?.rating ?? null,
  };
}

async function fetchLichessRatings(username: string) {
  const res = await fetch(
    `https://lichess.org/api/user/${username}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    bullet: data.perfs?.bullet?.rating ?? null,
    blitz: data.perfs?.blitz?.rating ?? null,
    rapid: data.perfs?.rapid?.rating ?? null,
  };
}

async function updateRatings() {
  console.log(`[Cron] Updating ratings at ${new Date().toISOString()}`);

  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  // Fetch accounts that haven't been updated in STALE_MINUTES, oldest first
  // Also includes accounts that have never been updated (ratings_updated_at is null)
  const { data: accounts, error } = await supabase
    .from('linked_accounts')
    .select('id, platform, platform_username, ratings_updated_at')
    .is('unlinked_at', null)
    .or(`ratings_updated_at.is.null,ratings_updated_at.lt.${staleThreshold}`)
    .order('ratings_updated_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[Cron] Failed to fetch accounts:', error.message);
    return;
  }

  if (!accounts || accounts.length === 0) {
    console.log('[Cron] All accounts are up to date');
    return;
  }

  console.log(`[Cron] Processing ${accounts.length} stale accounts`);

  let updated = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      let ratings: { bullet: number | null; blitz: number | null; rapid: number | null } | null = null;

      if (account.platform === 'chesscom') {
        ratings = await fetchChesscomRatings(account.platform_username);
      } else if (account.platform === 'lichess') {
        ratings = await fetchLichessRatings(account.platform_username);
      }

      if (ratings) {
        const { error: updateError } = await supabase
          .from('linked_accounts')
          .update({
            rating_bullet: ratings.bullet,
            rating_blitz: ratings.blitz,
            rating_rapid: ratings.rapid,
            ratings_updated_at: new Date().toISOString(),
          })
          .eq('id', account.id);

        if (updateError) {
          console.error(`[Cron] Failed to update ${account.platform_username}:`, updateError.message);
          failed++;
        } else {
          updated++;
        }
      } else {
        failed++;
      }

      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    } catch (e) {
      console.error(`[Cron] Error updating ${account.platform_username}:`, e);
      failed++;
    }
  }

  console.log(`[Cron] Batch complete: ${updated} updated, ${failed} failed`);
}

updateRatings();
