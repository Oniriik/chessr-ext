/**
 * Update Ratings
 * Fetches latest ratings from Chess.com and Lichess APIs
 * for all active linked accounts and updates the database
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const RATE_LIMIT_MS = 500; // 500ms between API calls

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

  const { data: accounts, error } = await supabase
    .from('linked_accounts')
    .select('id, platform, platform_username, rating_rapid')
    .is('unlinked_at', null);

  if (error || !accounts) {
    console.error('[Cron] Failed to fetch accounts:', error?.message);
    return;
  }

  console.log(`[Cron] Found ${accounts.length} active linked accounts`);

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

      // Rate limit between API calls
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    } catch (e) {
      console.error(`[Cron] Error updating ${account.platform_username}:`, e);
      failed++;
    }
  }

  console.log(`[Cron] Rating update complete: ${updated} updated, ${failed} failed out of ${accounts.length}`);
}

// Run immediately
updateRatings();
