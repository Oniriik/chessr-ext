/**
 * Guild role sync — every 30 min walks the configured Discord guild
 * and reconciles each member's plan + ELO roles with the data in
 * Supabase.
 *
 * Behavior per member:
 *
 *   1. Member's Discord id IS in user_settings.discord_id
 *      a. Plan role: ensure the role matching user_settings.plan is
 *         present, strip any other managed plan role.
 *      b. ELO role: pick the bracket from the highest rating across
 *         linked_accounts.{rating_bullet,rating_blitz,rating_rapid}
 *         (skip if no rating known — leaves any existing ELO role
 *         untouched would be wrong; we strip and let the next ELO
 *         refresh re-add).
 *
 *   2. Member's Discord id is NOT in user_settings (= unlinked /
 *      never linked) → strip every managed plan + ELO role. Keeps
 *      community members who never connected from accidentally
 *      keeping a stale role from a past link.
 *
 * Rate-limiting: each PUT/DELETE against /guilds/.../members/.../roles
 * is one Discord API call. The bot's bucket is 50/s per route; we
 * sleep 50ms between members to stay comfortably under it.
 *
 * The plan-sync event handlers already cover real-time changes
 * (plan_changed / discord_linked / etc.) — this cron is the
 * belt-and-suspenders for anything the event bus missed (e.g. an
 * admin nuked a role manually).
 */

import type { Client, GuildMember } from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { syncPlanRole, syncEloRole } from '../lib/discordRoles.js';

const TICK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const PER_MEMBER_DELAY_MS = 50;          // soft rate limit

interface LinkedUser {
  user_id: string;
  discord_id: string;
  plan: string;
  highestElo: number;
}

async function fetchLinkedUsers(): Promise<Map<string, LinkedUser>> {
  const map = new Map<string, LinkedUser>();
  // 1) pull user_settings rows that have a discord_id
  const { data: settings, error } = await supabase
    .from('user_settings')
    .select('user_id, discord_id, plan')
    .not('discord_id', 'is', null);
  if (error || !settings) {
    log.warn('[guild-sync] user_settings fetch failed:', error?.message);
    return map;
  }

  // 2) pull ratings for those users
  const userIds = settings.map((s) => s.user_id as string);
  if (userIds.length === 0) return map;
  const { data: accounts } = await supabase
    .from('linked_accounts')
    .select('user_id, rating_bullet, rating_blitz, rating_rapid')
    .in('user_id', userIds)
    .is('unlinked_at', null);

  const eloByUser = new Map<string, number>();
  for (const a of (accounts ?? []) as Array<{ user_id: string; rating_bullet: number | null; rating_blitz: number | null; rating_rapid: number | null }>) {
    const high = Math.max(a.rating_bullet ?? 0, a.rating_blitz ?? 0, a.rating_rapid ?? 0);
    const prev = eloByUser.get(a.user_id) ?? 0;
    if (high > prev) eloByUser.set(a.user_id, high);
  }

  for (const s of settings as Array<{ user_id: string; discord_id: string; plan: string }>) {
    map.set(s.discord_id, {
      user_id: s.user_id,
      discord_id: s.discord_id,
      plan: s.plan ?? 'free',
      highestElo: eloByUser.get(s.user_id) ?? 0,
    });
  }
  return map;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncOne(member: GuildMember, linked: LinkedUser | undefined): Promise<void> {
  if (!linked) {
    // Unlinked / never linked → strip every managed role.
    await syncPlanRole(member.id, null);
    await syncEloRole(member.id, null);
    return;
  }
  await syncPlanRole(member.id, linked.plan);
  await syncEloRole(member.id, linked.highestElo > 0 ? linked.highestElo : null);
}

async function tick(client: Client): Promise<void> {
  const guildId = config.discord.guildId;
  if (!guildId) {
    log.warn('[guild-sync] no DISCORD_GUILD_ID configured, skipping');
    return;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    log.warn(`[guild-sync] guild ${guildId} not reachable`);
    return;
  }

  // Pull the full member list once. For a few-thousand-member guild
  // this is one /guilds/{id}/members?limit=1000 paginated fetch —
  // fast enough to do every 30 min.
  const members = await guild.members.fetch().catch(() => null);
  if (!members) {
    log.warn('[guild-sync] members.fetch failed');
    return;
  }

  const linked = await fetchLinkedUsers();
  log.info(`[guild-sync] sweeping ${members.size} members against ${linked.size} linked users`);

  let touched = 0;
  let unlinkedStripped = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const entry = linked.get(member.id);
    try {
      await syncOne(member, entry);
      if (entry) touched++;
      else unlinkedStripped++;
    } catch (err) {
      log.warn(`[guild-sync] sync failed for ${member.user.tag}:`, err);
    }
    await sleep(PER_MEMBER_DELAY_MS);
  }
  log.info(`[guild-sync] done — linked=${touched} unlinked=${unlinkedStripped}`);
}

export function registerGuildRoleSync(client: Client): void {
  // Kick off ~30s after boot so the bot is fully connected + cached
  // before we hammer the API.
  setTimeout(() => { void tick(client); }, 30_000);
  setInterval(() => { void tick(client); }, TICK_INTERVAL_MS);
  log.info(`[guild-sync] periodic sweep registered (every ${TICK_INTERVAL_MS / 60_000} min)`);
}
