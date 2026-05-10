/**
 * Boost → wheel-token handler.
 *
 * Two flows:
 *
 *  1. guildMemberUpdate (real-time)
 *     User starts (or re-starts) boosting → POST /admin/wheel/token/record
 *     with source='boost' and external_ref=premium_since. Public message
 *     in DISCORD_BOOST_CHANNEL_ID telling them they have a token.
 *
 *  2. Reconciliation (boot + every 30 min)
 *     guildMemberUpdate isn't replayed by Discord, so a boost during a
 *     bot outage would otherwise be lost. We periodically scan the
 *     guild's members and idempotent-record every active booster's
 *     token. The unique index on (owner, source, external_ref) makes
 *     this a cheap no-op for already-known boosts.
 *
 * Lifetime / beta users: the bot doesn't filter them out here — every
 * boost yields a token. The /inventory + /spin flow takes care of the
 * "your plan can't be extended, gift it instead" UX downstream.
 */

import {
  type Client,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

const RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

async function recordBoostToken(
  discordId: string,
  premiumSince: Date,
): Promise<{ recorded: boolean }> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}/admin/wheel/token/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({
      discordId,
      source: 'boost',
      externalRef: premiumSince.toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`record HTTP ${res.status}`);
  return res.json() as Promise<{ recorded: boolean }>;
}

async function postBoostThanks(client: Client, member: GuildMember): Promise<void> {
  const channelId = config.discord.boostChannelId;
  if (!channelId) {
    log.warn('[boost] DISCORD_BOOST_CHANNEL_ID not set — skipping public message');
    return;
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    log.warn(`[boost] channel ${channelId} not reachable / not text-based`);
    return;
  }
  await (channel as TextChannel).send({
    content:
      `<@${member.id}>\n` +
      `🚀 Thanks for boosting!\n` +
      `You earned 1 🎟️ Boost Token — added to your inventory.\n` +
      `Use \`/inventory\` to spin the wheel.`,
    allowedMentions: { users: [member.id] },
  });
}

async function handleBoost(client: Client, member: GuildMember, premiumSince: Date): Promise<void> {
  let recorded = false;
  try {
    const r = await recordBoostToken(member.id, premiumSince);
    recorded = r.recorded;
  } catch (err) {
    log.error(`[boost] failed to record token for ${member.id}:`, err);
    return;
  }

  // Skip the public message on duplicate events — unique index already
  // de-duped at the row level, no need to spam #general.
  if (!recorded) {
    log.info(`[boost] ${member.id} duplicate boost event (premium_since=${premiumSince.toISOString()}), skipping post`);
    return;
  }

  log.info(`[boost] new boost recorded for ${member.id} (premium_since=${premiumSince.toISOString()})`);
  await postBoostThanks(client, member);
}

// ─── Boot + periodic reconciliation ──────────────────────────────────────

async function reconcileBoosts(client: Client): Promise<void> {
  const guildId = config.discord.guildId;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    log.warn(`[boost] reconcile: guild ${guildId} not reachable`);
    return;
  }
  // GUILD_MEMBERS intent is required for the .fetch() call to return
  // every member with their premium_since populated.
  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    log.warn('[boost] reconcile members.fetch failed:', err);
    return;
  }

  let attempted = 0;
  let recorded = 0;
  for (const member of members.values()) {
    if (!member.premiumSince) continue;
    attempted++;
    try {
      const r = await recordBoostToken(member.id, member.premiumSince);
      if (r.recorded) recorded++;
    } catch (err) {
      log.warn(`[boost] reconcile record failed for ${member.id}:`, err);
    }
  }
  log.info(`[boost] reconciliation: ${recorded}/${attempted} new tokens recorded`);
}

export function registerBoostReward(client: Client): void {
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const oldSince = (oldMember as GuildMember | PartialGuildMember).premiumSince ?? null;
      const newSince = newMember.premiumSince ?? null;
      if (!newSince) return;                                       // not boosting / stopped boosting
      if (oldSince && oldSince.getTime() === newSince.getTime()) return; // unchanged
      await handleBoost(client, newMember as GuildMember, newSince);
    } catch (err) {
      log.error('[boost] guildMemberUpdate handler threw:', err);
    }
  });

  // Boot + interval reconciliation. Defer the boot run a few seconds so
  // the gateway is fully ready and we're not racing the initial member
  // chunk events.
  setTimeout(() => {
    reconcileBoosts(client).catch((err) => log.error('[boost] reconcile boot failed:', err));
    setInterval(
      () => reconcileBoosts(client).catch((err) => log.error('[boost] reconcile interval failed:', err)),
      RECONCILE_INTERVAL_MS,
    );
  }, 5_000);

  log.info('[boost] handler registered');
}
