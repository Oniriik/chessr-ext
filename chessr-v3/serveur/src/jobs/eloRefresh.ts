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
 * Real-time role sync: when a user's highest cross-platform rating
 * crosses a bracket boundary (0/800/1000/1200/1400/1600/1800/2000),
 * we emit `elo_bracket_changed` so the bot can flip the Discord role
 * within seconds instead of waiting up to 30 min for the periodic
 * guild-sync sweep. We pre-fetch all linked_accounts + discord_ids for
 * users in the batch so the cross-platform max is accurate.
 *
 * Banned detection: chess.com returns 404 for closed accounts (TOS
 * bans, voluntary deletes, username changes). The row is flagged
 * `banned = true` so subsequent ticks skip it, and we emit
 * `chess_account_banned` exactly once per row so the bot can ping
 * #users. Without this flag the cron used to monopolise every batch
 * re-fetching the same dead rows because `ratings_updated_at` only
 * bumped on success.
 *
 * Every fetch outcome (success / 404 / other error / network throw)
 * bumps `ratings_updated_at` so the row rotates to the back of the
 * queue and the cron always makes forward progress.
 *
 * Ported from chessr-next/cron/update-ratings.ts; same boundaries
 * (BATCH_SIZE=25, RATE_LIMIT_MS=500, STALE_MINUTES=15) so we don't
 * trip the public APIs.
 */

import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/events.js';

const BATCH_SIZE = 25;
const RATE_LIMIT_MS = 500;
const STALE_MINUTES = 15;

// Bracket floor thresholds — must stay in sync with the bot's ELO_BRACKETS
// in discord-bot/src/lib/discordRoles.ts. A change here without a matching
// bump there will mean the bot ignores events for the new bracket.
const BRACKET_FLOORS = [0, 800, 1000, 1200, 1400, 1600, 1800, 2000];

interface PlatformRatings {
  bullet: number | null;
  blitz: number | null;
  rapid: number | null;
}

interface FetchResult {
  status: number;            // 0 on network error, otherwise the HTTP status
  ratings: PlatformRatings | null;
}

interface AccountRow {
  id: string;
  user_id: string;
  platform: string;
  platform_username: string;
  rating_bullet: number | null;
  rating_blitz: number | null;
  rating_rapid: number | null;
}

function bracketFloor(elo: number): number {
  if (elo <= 0) return -1; // distinct from 0 so unrated → rated triggers
  let floor = 0;
  for (const b of BRACKET_FLOORS) if (elo >= b) floor = b;
  return floor;
}

async function fetchChesscomRatings(username: string): Promise<FetchResult> {
  try {
    const res = await fetch(
      `https://api.chess.com/pub/player/${username}/stats`,
      { headers: { 'User-Agent': 'Chessr.io Rating Updater' } },
    );
    if (!res.ok) {
      console.warn(`[elo-refresh] chesscom fetch ${res.status} for "${username}"`);
      return { status: res.status, ratings: null };
    }
    const data = (await res.json()) as {
      chess_bullet?: { last?: { rating?: number } };
      chess_blitz?: { last?: { rating?: number } };
      chess_rapid?: { last?: { rating?: number } };
    };
    return {
      status: 200,
      ratings: {
        bullet: data.chess_bullet?.last?.rating ?? null,
        blitz:  data.chess_blitz?.last?.rating  ?? null,
        rapid:  data.chess_rapid?.last?.rating  ?? null,
      },
    };
  } catch (err) {
    console.warn(`[elo-refresh] chesscom network error for "${username}":`, err instanceof Error ? err.message : err);
    return { status: 0, ratings: null };
  }
}

async function fetchLichessRatings(username: string): Promise<FetchResult> {
  try {
    const res = await fetch(
      `https://lichess.org/api/user/${username}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) {
      console.warn(`[elo-refresh] lichess fetch ${res.status} for "${username}"`);
      return { status: res.status, ratings: null };
    }
    const data = (await res.json()) as {
      perfs?: {
        bullet?: { rating?: number };
        blitz?: { rating?: number };
        rapid?: { rating?: number };
      };
    };
    return {
      status: 200,
      ratings: {
        bullet: data.perfs?.bullet?.rating ?? null,
        blitz:  data.perfs?.blitz?.rating  ?? null,
        rapid:  data.perfs?.rapid?.rating  ?? null,
      },
    };
  } catch (err) {
    console.warn(`[elo-refresh] lichess network error for "${username}":`, err instanceof Error ? err.message : err);
    return { status: 0, ratings: null };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runEloRefresh(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  const { data: accounts, error } = await supabase
    .from('linked_accounts')
    .select('id, user_id, platform, platform_username, rating_bullet, rating_blitz, rating_rapid, ratings_updated_at')
    .is('unlinked_at', null)
    .eq('banned', false)
    .or(`ratings_updated_at.is.null,ratings_updated_at.lt.${staleThreshold}`)
    .order('ratings_updated_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.warn('[elo-refresh] supabase query failed:', error.message);
    return;
  }
  if (!accounts || accounts.length === 0) return;

  const rows = accounts as AccountRow[];

  // Pre-fetch every linked account for the users in this batch (across all
  // platforms) so we can compute the cross-platform highest. Without this,
  // a rating drop on chess.com could falsely look like a bracket downgrade
  // even though the user's lichess rating still puts them in the same one.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: allLinked } = await supabase
    .from('linked_accounts')
    .select('id, user_id, rating_bullet, rating_blitz, rating_rapid')
    .in('user_id', userIds)
    .is('unlinked_at', null)
    .eq('banned', false);

  // user_id → list of {id, ratings}. Mutated in-place as we apply updates
  // so newHigh reflects the post-update cross-platform max.
  const ratingsByUser = new Map<string, Array<{ id: string; bullet: number | null; blitz: number | null; rapid: number | null }>>();
  for (const a of (allLinked ?? []) as Array<{ id: string; user_id: string; rating_bullet: number | null; rating_blitz: number | null; rating_rapid: number | null }>) {
    const list = ratingsByUser.get(a.user_id) ?? [];
    list.push({ id: a.id, bullet: a.rating_bullet, blitz: a.rating_blitz, rapid: a.rating_rapid });
    ratingsByUser.set(a.user_id, list);
  }

  // Pre-fetch discord_ids for the batch. Users without a linked Discord
  // skip the event emission (no role to sync) but still get their ratings
  // updated.
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, discord_id')
    .in('user_id', userIds)
    .not('discord_id', 'is', null);
  const discordByUser = new Map<string, string>();
  for (const s of (settings ?? []) as Array<{ user_id: string; discord_id: string }>) {
    discordByUser.set(s.user_id, s.discord_id);
  }

  function userHigh(uid: string): number {
    const list = ratingsByUser.get(uid) ?? [];
    let max = 0;
    for (const a of list) {
      const local = Math.max(a.bullet ?? 0, a.blitz ?? 0, a.rapid ?? 0);
      if (local > max) max = local;
    }
    return max;
  }

  let updated = 0;
  let failed = 0;
  let banned = 0;
  let bracketChanges = 0;

  for (const account of rows) {
    try {
      let result: FetchResult;
      if (account.platform === 'chesscom') {
        result = await fetchChesscomRatings(account.platform_username);
      } else if (account.platform === 'lichess') {
        result = await fetchLichessRatings(account.platform_username);
      } else {
        // worldchess et al. — skip, but bump the timestamp so we don't
        // hot-loop on them every tick.
        await supabase
          .from('linked_accounts')
          .update({ ratings_updated_at: new Date().toISOString() })
          .eq('id', account.id);
        continue;
      }

      // 404 → permanently banned (closed account / username change). Flag
      // the row, emit the event once, drop it out of the rotation.
      if (result.status === 404) {
        await supabase
          .from('linked_accounts')
          .update({
            banned: true,
            banned_detected_at: new Date().toISOString(),
            ratings_updated_at: new Date().toISOString(),
          })
          .eq('id', account.id);
        banned++;
        await emitEvent({
          type: 'chess_account_banned',
          user_id: account.user_id,
          payload: {
            platform: account.platform,
            platform_username: account.platform_username,
            discordId: discordByUser.get(account.user_id) ?? null,
          },
        });
        // Drop from in-memory map so the cross-platform max recompute
        // ignores the dead row from here on.
        const list = ratingsByUser.get(account.user_id);
        if (list) ratingsByUser.set(account.user_id, list.filter((e) => e.id !== account.id));
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      // Any other non-200 (429 rate-limit, 5xx, network error). We can't
      // distinguish a transient API blip from a permanent issue, so we
      // bump the timestamp to rotate the row out of the next batch and
      // try again on the next stale cycle. The warn log lives in the
      // fetcher; we'll inspect aggregated counts over time and decide
      // case-by-case whether new error types deserve special handling.
      if (!result.ratings) {
        await supabase
          .from('linked_accounts')
          .update({ ratings_updated_at: new Date().toISOString() })
          .eq('id', account.id);
        failed++;
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      // 200 — write ratings and check for bracket changes.
      const oldHigh = userHigh(account.user_id);

      const { error: upErr } = await supabase
        .from('linked_accounts')
        .update({
          rating_bullet: result.ratings.bullet,
          rating_blitz:  result.ratings.blitz,
          rating_rapid:  result.ratings.rapid,
          ratings_updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);
      if (upErr) {
        console.warn(`[elo-refresh] update failed for ${account.platform_username}:`, upErr.message);
        failed++;
        await sleep(RATE_LIMIT_MS);
        continue;
      }

      updated++;

      // Mutate the in-memory map so the cross-platform max stays
      // correct as we proceed through the batch.
      const list = ratingsByUser.get(account.user_id) ?? [];
      const entry = list.find((e) => e.id === account.id);
      if (entry) {
        entry.bullet = result.ratings.bullet;
        entry.blitz  = result.ratings.blitz;
        entry.rapid  = result.ratings.rapid;
      }

      const newHigh = userHigh(account.user_id);
      const oldBracket = bracketFloor(oldHigh);
      const newBracket = bracketFloor(newHigh);
      const discordId = discordByUser.get(account.user_id);

      if (discordId && oldBracket !== newBracket) {
        bracketChanges++;
        await emitEvent({
          type: 'elo_bracket_changed',
          user_id: account.user_id,
          payload: {
            discordId,
            newElo: newHigh,
            oldBracket: oldBracket < 0 ? null : oldBracket,
            newBracket: newBracket < 0 ? null : newBracket,
          },
        });
      }
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`[elo-refresh] error for ${account.platform_username}:`, err);
      // Bump the timestamp on unexpected exceptions too, so the row
      // doesn't permanently park at the head of the queue.
      await supabase
        .from('linked_accounts')
        .update({ ratings_updated_at: new Date().toISOString() })
        .eq('id', account.id)
        .then(() => undefined, () => undefined);
      failed++;
    }
  }

  if (updated > 0 || failed > 0 || banned > 0) {
    console.info(`[elo-refresh] batch: ${updated} updated / ${failed} failed / ${banned} banned / ${bracketChanges} bracket changes (of ${rows.length})`);
  }
}
