/**
 * Stats voice channels — periodic rename to surface live metrics in
 * the Discord channel list.
 *
 * Discord rate-limits **channel renames at 2 modifications per 10
 * minutes per channel**. The whole loop runs once per 10 minutes and
 * staggers the actual renames 1 minute apart so no single channel is
 * ever touched more than once per window. Renaming N channels at the
 * exact same instant works today but blows the budget the moment you
 * need to retry one.
 *
 * Channels (set via env, partial setups are fine):
 *   DISCORD_STATS_USERS_CHANNEL_ID    👥 Total Users: N
 *   DISCORD_STATS_PLAYING_CHANNEL_ID  👁️ Playing Now: N    (live WS)
 *   DISCORD_STATS_MOVES_CHANNEL_ID    🧠 Moves Analyzed: N (placeholder)
 *   DISCORD_STATS_PREMIUM_CHANNEL_ID  ⭐ Premium: N        (premium+lifetime+beta)
 *
 * Names are skipped when unchanged so we don't burn the rate budget on
 * idle ticks.
 */

import type { Client, GuildChannel } from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

const TICK_INTERVAL_MS = 10 * 60 * 1000;   // 10 min — full refresh
const RENAME_OFFSET_MS = 60 * 1000;        // 1 min between renames in a tick

// Placeholder until the local-postgres migration ships the real
// counter. The screenshot shows ~873.8K — we surface the same ballpark
// so the channel doesn't read as empty in beta.
const PLACEHOLDER_MOVES_ANALYZED = 873_800;

/** Pretty-print large integers with K / M suffixes (matches the v2 UI). */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

async function totalUsers(): Promise<number | null> {
  // auth.users is the source of truth — user_settings has a row per
  // user but might be missing for very fresh signups in rare races.
  const { count, error } = await supabase
    .from('user_settings')
    .select('user_id', { count: 'exact', head: true });
  if (error) {
    log.warn('[stats] totalUsers query failed:', error.message);
    return null;
  }
  return count ?? 0;
}

async function premiumUsers(): Promise<number | null> {
  const { count, error } = await supabase
    .from('user_settings')
    .select('user_id', { count: 'exact', head: true })
    .in('plan', ['premium', 'lifetime', 'beta']);
  if (error) {
    log.warn('[stats] premiumUsers query failed:', error.message);
    return null;
  }
  return count ?? 0;
}

/** Live WS-connected count via the serveur's admin endpoint. We only
 *  need the length, not the per-user details. */
async function playingNow(): Promise<number | null> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) return null;
  try {
    const res = await fetch(`${url}/admin/users/connected`, {
      headers: { 'x-admin-token': adminToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { users?: unknown[] };
    return Array.isArray(data.users) ? data.users.length : 0;
  } catch (err) {
    log.warn('[stats] playingNow fetch failed:', err);
    return null;
  }
}

/** Rename a channel only if the new name is different. Discord rejects
 *  no-op renames silently — same effect on the rate budget either way
 *  — but skipping the call entirely keeps logs clean. */
async function renameIfChanged(channel: GuildChannel, name: string): Promise<void> {
  if (channel.name === name) return;
  try {
    await channel.setName(name, 'stats refresh');
    log.debug(`[stats] renamed ${channel.id} → "${name}"`);
  } catch (err) {
    // 50035 (Invalid Form Body) usually means the new name violates
    // Discord's rules (length, control chars). 30019 / 429 = rate
    // limited — log + move on, next tick will retry.
    log.warn(`[stats] rename failed for ${channel.id}:`, err);
  }
}

/** Compose the full label and rename. No-op when the channel ID is
 *  unset, the channel can't be fetched, or the value is null
 *  (failed query). */
async function updateChannel(
  client: Client,
  channelId: string | undefined,
  emoji: string,
  label: string,
  value: number | null,
): Promise<void> {
  if (!channelId || value === null) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !('setName' in channel)) {
    log.warn(`[stats] channel ${channelId} not reachable or not renamable`);
    return;
  }
  const name = `${emoji} ${label}: ${formatCount(value)}`;
  await renameIfChanged(channel as GuildChannel, name);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fetch all four metrics in parallel, then rename the matching
 *  channels with 1-minute spacing. Order matters only for visual
 *  staggering — the values are computed up front so the UI lag is
 *  bounded by the longest sleep slot, not by the slowest query. */
async function tick(client: Client): Promise<void> {
  const ids = config.discord.statsChannels;
  if (!ids.users && !ids.playing && !ids.moves && !ids.premium) return;

  const [users, playing, premium] = await Promise.all([
    totalUsers(),
    playingNow(),
    premiumUsers(),
  ]);

  log.info(
    `[stats] tick — users=${users ?? '?'} playing=${playing ?? '?'} ` +
    `moves=${PLACEHOLDER_MOVES_ANALYZED} premium=${premium ?? '?'}`,
  );

  // Stagger: 0min, 1min, 2min, 3min. Each channel touched once per
  // tick, well inside Discord's 2/10min ceiling.
  await updateChannel(client, ids.users,   '👥', 'Total Users',     users);
  await sleep(RENAME_OFFSET_MS);
  await updateChannel(client, ids.playing, '👁️', 'Playing Now',     playing);
  await sleep(RENAME_OFFSET_MS);
  await updateChannel(client, ids.moves,   '🧠', 'Moves Analyzed',  PLACEHOLDER_MOVES_ANALYZED);
  await sleep(RENAME_OFFSET_MS);
  await updateChannel(client, ids.premium, '⭐', 'Premium',         premium);
}

let started = false;

/** Kick off the periodic refresh. Idempotent — safe to call multiple
 *  times (the second call is a no-op). */
export function startStatsChannels(client: Client): void {
  if (started) return;
  started = true;
  log.info('[stats] starting stats-channel refresh loop (10-min cadence)');

  // First tick runs ~5s after boot so the bot has time to settle
  // before we hammer the Supabase + serveur endpoints.
  setTimeout(() => {
    tick(client).catch((err) => log.error('[stats] tick failed:', err));
    setInterval(() => {
      tick(client).catch((err) => log.error('[stats] tick failed:', err));
    }, TICK_INTERVAL_MS);
  }, 5_000);
}
