/**
 * ELO refresh — staleness-based batch updater for linked_accounts.
 *
 * Each tick fetches up to BATCH_SIZE accounts whose `ratings_updated_at`
 * is older than STALE_MINUTES (or never set), oldest first, and pulls
 * the current bullet/blitz/rapid rating from the platform's public API.
 * Updates land in Supabase on linked_accounts.
 *
 * Platforms: chess.com + lichess. Worldchess has no public ratings API;
 * its linked_accounts rows just keep whatever rating was captured at
 * link-time. The bot's ELO bracket sync (guildRoleSync) uses the
 * highest known rating across all platforms regardless.
 *
 * Ported from chessr-next/cron/update-ratings.ts; same boundaries
 * (BATCH_SIZE=25, RATE_LIMIT_MS=500, STALE_MINUTES=15) so we don't
 * trip the public APIs.
 */

import { supabase } from '../lib/supabase.js';

const BATCH_SIZE = 25;
const RATE_LIMIT_MS = 500;
const STALE_MINUTES = 15;

interface PlatformRatings {
  bullet: number | null;
  blitz: number | null;
  rapid: number | null;
}

async function fetchChesscomRatings(username: string): Promise<PlatformRatings | null> {
  const res = await fetch(
    `https://api.chess.com/pub/player/${username}/stats`,
    { headers: { 'User-Agent': 'Chessr.io Rating Updater' } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    chess_bullet?: { last?: { rating?: number } };
    chess_blitz?: { last?: { rating?: number } };
    chess_rapid?: { last?: { rating?: number } };
  };
  return {
    bullet: data.chess_bullet?.last?.rating ?? null,
    blitz:  data.chess_blitz?.last?.rating  ?? null,
    rapid:  data.chess_rapid?.last?.rating  ?? null,
  };
}

async function fetchLichessRatings(username: string): Promise<PlatformRatings | null> {
  const res = await fetch(
    `https://lichess.org/api/user/${username}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    perfs?: {
      bullet?: { rating?: number };
      blitz?: { rating?: number };
      rapid?: { rating?: number };
    };
  };
  return {
    bullet: data.perfs?.bullet?.rating ?? null,
    blitz:  data.perfs?.blitz?.rating  ?? null,
    rapid:  data.perfs?.rapid?.rating  ?? null,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runEloRefresh(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  const { data: accounts, error } = await supabase
    .from('linked_accounts')
    .select('id, platform, platform_username, ratings_updated_at')
    .is('unlinked_at', null)
    .or(`ratings_updated_at.is.null,ratings_updated_at.lt.${staleThreshold}`)
    .order('ratings_updated_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.warn('[elo-refresh] supabase query failed:', error.message);
    return;
  }
  if (!accounts || accounts.length === 0) return;

  let updated = 0;
  let failed = 0;

  for (const account of accounts as Array<{ id: string; platform: string; platform_username: string }>) {
    try {
      let ratings: PlatformRatings | null = null;
      if (account.platform === 'chesscom') {
        ratings = await fetchChesscomRatings(account.platform_username);
      } else if (account.platform === 'lichess') {
        ratings = await fetchLichessRatings(account.platform_username);
      } else {
        // worldchess et al. — skip, but bump the timestamp so we don't
        // hot-loop on them every tick.
        await supabase
          .from('linked_accounts')
          .update({ ratings_updated_at: new Date().toISOString() })
          .eq('id', account.id);
        continue;
      }

      if (ratings) {
        const { error: upErr } = await supabase
          .from('linked_accounts')
          .update({
            rating_bullet: ratings.bullet,
            rating_blitz:  ratings.blitz,
            rating_rapid:  ratings.rapid,
            ratings_updated_at: new Date().toISOString(),
          })
          .eq('id', account.id);
        if (upErr) {
          console.warn(`[elo-refresh] update failed for ${account.platform_username}:`, upErr.message);
          failed++;
        } else {
          updated++;
        }
      } else {
        failed++;
      }
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`[elo-refresh] error for ${account.platform_username}:`, err);
      failed++;
    }
  }

  if (updated > 0 || failed > 0) {
    console.info(`[elo-refresh] batch: ${updated} updated / ${failed} failed (of ${accounts.length})`);
  }
}
