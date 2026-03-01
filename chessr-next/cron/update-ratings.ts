/**
 * Update Ratings (batched)
 * Each run processes BATCH_SIZE accounts starting from a cursor,
 * then saves the cursor for the next run. Runs every 30 minutes.
 * With BATCH_SIZE=25 and 30min interval, all accounts cycle in ~6h for 300 accounts.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BATCH_SIZE = 25;
const RATE_LIMIT_MS = 500;
const CURSOR_KEY = 'ratings_cursor';

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

async function getCursor(): Promise<string> {
  const { data } = await supabase
    .from('global_stats')
    .select('value')
    .eq('key', CURSOR_KEY)
    .single();
  return data?.value || '';
}

async function saveCursor(cursor: string) {
  await supabase
    .from('global_stats')
    .upsert({ key: CURSOR_KEY, value: cursor, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

async function updateRatings() {
  console.log(`[Cron] Updating ratings batch at ${new Date().toISOString()}`);

  const cursor = await getCursor();

  // Fetch next batch of accounts after cursor, ordered by id
  let query = supabase
    .from('linked_accounts')
    .select('id, platform, platform_username')
    .is('unlinked_at', null)
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);

  if (cursor) {
    query = query.gt('id', cursor);
  }

  const { data: accounts, error } = await query;

  if (error) {
    console.error('[Cron] Failed to fetch accounts:', error.message);
    return;
  }

  // If no accounts found, we've reached the end — reset cursor
  if (!accounts || accounts.length === 0) {
    console.log('[Cron] Reached end of accounts, resetting cursor');
    await saveCursor('');
    return;
  }

  console.log(`[Cron] Processing batch of ${accounts.length} accounts (cursor: ${cursor || 'start'})`);

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

  // Save cursor to last processed account id
  const lastId = accounts[accounts.length - 1].id;
  await saveCursor(lastId);

  console.log(`[Cron] Batch complete: ${updated} updated, ${failed} failed — next cursor: ${lastId}`);
}

updateRatings();
