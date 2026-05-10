/**
 * Server-boost reward handler.
 *
 * Two flows:
 *
 *  1. guildMemberUpdate → boost detected
 *     - INSERT a (discord_id, done_at) row in `discord_boosts` (idempotent
 *       via the serveur's /admin/boost/record).
 *     - If the booster has a Chessr account linked: extend their plan
 *       and stamp granted_at + user_id. Public message in the boost
 *       channel: "Thx for boosting @user — added 15 days …".
 *     - If not linked: leave granted_at NULL. Public message asks them
 *       to link their Discord in the extension; the link callback
 *       replays the row.
 *
 *  2. discord_linked event (from Redis events bus)
 *     - Look up every pending row for that discord_id (granted_at NULL).
 *     - Apply each reward in order, stamping granted_at + user_id.
 *     - One "we applied your boost reward" message per replay.
 *
 * Plan branches stay the same as before:
 *   - free / freetrial            → set plan='premium', plan_expiry = max(now, prev) + N d
 *   - premium (dashboard)         → plan_expiry += N d
 *   - premium (active Paddle sub) → POST /admin/paddle/extend
 *   - lifetime / beta             → no extend, still mark granted so we don't re-prompt
 */

import {
  type Client,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';
import { onEvent, type IncomingEvent } from '../lib/events.js';

const REWARD_DAYS = 15;

type RewardPath = 'dashboard' | 'paddle' | 'no_extend';

interface ChessrAccount {
  user_id: string;
  email: string | null;
  plan: string;
  plan_expiry: string | null;
  paddle_sub_id: string | null;
  paddle_status: string | null;
  paddle_canceled_at: string | null;
}

// ─── Lookups ──────────────────────────────────────────────────────────────

async function findAccountByDiscord(discordId: string): Promise<ChessrAccount | null> {
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, plan_expiry')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (!settings) return null;
  return enrich(settings.user_id, settings.plan ?? 'free', settings.plan_expiry ?? null);
}

async function findAccountByUserId(userId: string): Promise<ChessrAccount | null> {
  const { data: settings } = await supabase
    .from('user_settings')
    .select('plan, plan_expiry')
    .eq('user_id', userId)
    .maybeSingle();
  if (!settings) return null;
  return enrich(userId, settings.plan ?? 'free', settings.plan_expiry ?? null);
}

async function enrich(userId: string, plan: string, planExpiry: string | null): Promise<ChessrAccount> {
  const [{ data: auth }, { data: sub }] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    supabase
      .from('subscriptions')
      .select('paddle_subscription_id, status, canceled_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  return {
    user_id: userId,
    email: auth?.user?.email ?? null,
    plan,
    plan_expiry: planExpiry,
    paddle_sub_id: sub?.paddle_subscription_id ?? null,
    paddle_status: sub?.status ?? null,
    paddle_canceled_at: sub?.canceled_at ?? null,
  };
}

function isActivePaddle(account: ChessrAccount): boolean {
  return (
    !!account.paddle_sub_id &&
    account.paddle_status !== 'canceled' &&
    !account.paddle_canceled_at
  );
}

function pickPath(account: ChessrAccount): RewardPath {
  if (account.plan === 'lifetime' || account.plan === 'beta') return 'no_extend';
  return isActivePaddle(account) ? 'paddle' : 'dashboard';
}

// ─── Serveur calls (admin-token-gated) ────────────────────────────────────

async function recordBoost(
  discordId: string,
  doneAt: Date,
  userId: string | null,
): Promise<{ recorded: boolean }> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}/admin/boost/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({
      discordId,
      doneAt: doneAt.toISOString(),
      userId,
      rewardDays: REWARD_DAYS,
    }),
  });
  if (!res.ok) throw new Error(`record HTTP ${res.status}`);
  return res.json() as Promise<{ recorded: boolean }>;
}

async function grantBoost(
  discordId: string,
  doneAt: Date,
  userId: string,
  rewardPath: RewardPath,
): Promise<{ granted: boolean }> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}/admin/boost/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ discordId, doneAt: doneAt.toISOString(), userId, rewardPath }),
  });
  if (!res.ok) throw new Error(`grant HTTP ${res.status}`);
  return res.json() as Promise<{ granted: boolean }>;
}

async function releaseGrant(discordId: string, doneAt: Date): Promise<void> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) return;
  await fetch(`${url}/admin/boost/grant`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ discordId, doneAt: doneAt.toISOString() }),
  }).catch((err) => log.warn('[boost] release failed:', err));
}

async function fetchPending(discordId: string): Promise<Array<{ done_at: string; reward_days: number }>> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(
    `${url}/admin/boost/pending?discordId=${encodeURIComponent(discordId)}`,
    { headers: { 'x-admin-token': adminToken } },
  );
  if (!res.ok) throw new Error(`pending HTTP ${res.status}`);
  const data = (await res.json()) as { pending: Array<{ done_at: string; reward_days: number }> };
  return data.pending ?? [];
}

async function emitPlanChanged(
  account: ChessrAccount,
  newPlan: string,
  newExpiry: string,
): Promise<void> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) return;
  await fetch(`${url}/admin/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({
      type: 'plan_changed',
      user_id: account.user_id,
      payload: {
        oldPlan: account.plan,
        newPlan,
        oldExpiry: account.plan_expiry,
        newExpiry,
        reason: 'discord_boost',
      },
    }),
  }).catch((err) => log.warn('[boost] event emit failed:', err));
}

// ─── Plan extensions ──────────────────────────────────────────────────────

function computeNewExpiry(currentExpiry: string | null, days: number): string {
  const base = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const start = Math.max(Date.now(), base);
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

async function extendDashboard(account: ChessrAccount, days: number): Promise<void> {
  const newExpiry = computeNewExpiry(account.plan_expiry, days);
  const newPlan =
    account.plan === 'free' || account.plan === 'freetrial' ? 'premium' : account.plan;

  const { error } = await supabase
    .from('user_settings')
    .update({
      plan: newPlan,
      plan_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', account.user_id);
  if (error) throw new Error(`user_settings update: ${error.message}`);

  await emitPlanChanged(account, newPlan, newExpiry);
}

async function extendPaddle(account: ChessrAccount, days: number): Promise<void> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}/admin/paddle/extend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ userId: account.user_id, days, reason: 'discord_boost' }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`paddle extend HTTP ${res.status}: ${json.error ?? ''}`);
  }
}

async function applyExtension(account: ChessrAccount, path: RewardPath, days: number): Promise<void> {
  if (path === 'no_extend') return;
  if (path === 'paddle')   await extendPaddle(account, days);
  else                     await extendDashboard(account, days);
}

// ─── Public messages ─────────────────────────────────────────────────────

async function postInBoostChannel(client: Client, content: string): Promise<void> {
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
  const userIdMatch = content.match(/<@(\d+)>/);
  await (channel as TextChannel).send({
    content,
    allowedMentions: userIdMatch ? { users: [userIdMatch[1]] } : { parse: [] },
  });
}

function thanksLinkedMessage(member: { id: string }, account: ChessrAccount, path: RewardPath, days: number): string {
  const tail =
    path === 'paddle'
      ? `we extended your subscription by **${days} days**`
      : path === 'no_extend'
        ? `you already have **${account.plan}** access — boost noted, thanks 💜`
        : `we added **${days} days** of premium to your account`;
  const email = account.email ? ` \`${account.email}\`` : '';
  return `🚀 Thx for boosting <@${member.id}> — ${tail}${email}.`;
}

function thanksUnlinkedMessage(member: { id: string }, days: number): string {
  return (
    `🚀 Thx for boosting <@${member.id}>! Please link your Discord inside the ` +
    `Chessr extension to get your **${days} days** of premium added automatically.`
  );
}

function retroactiveGrantMessage(discordId: string, applied: number, days: number): string {
  if (applied === 1) {
    return `🚀 <@${discordId}> we applied your pending boost reward — **${days} days** of premium added.`;
  }
  return `🚀 <@${discordId}> we applied **${applied}** pending boost rewards — **${applied * days} days** of premium added.`;
}

// ─── Boost-detected flow (guildMemberUpdate) ─────────────────────────────

async function handleBoost(member: GuildMember, doneAt: Date, client: Client): Promise<void> {
  const account = await findAccountByDiscord(member.id);

  // Always record the row first — we want a trace even if the user
  // isn't linked yet so the link callback can replay.
  try {
    await recordBoost(member.id, doneAt, account?.user_id ?? null);
  } catch (err) {
    log.error('[boost] record failed:', err);
    return;
  }

  if (!account) {
    await postInBoostChannel(client, thanksUnlinkedMessage(member, REWARD_DAYS));
    return;
  }

  const path = pickPath(account);
  try {
    if (path !== 'no_extend') await applyExtension(account, path, REWARD_DAYS);
    const { granted } = await grantBoost(member.id, doneAt, account.user_id, path);
    if (granted) {
      await postInBoostChannel(client, thanksLinkedMessage(member, account, path, REWARD_DAYS));
      log.info(`[boost] granted ${REWARD_DAYS}d to ${member.id} via ${path}`);
    } else {
      log.info(`[boost] ${member.id} already granted for done_at=${doneAt.toISOString()}`);
    }
  } catch (err) {
    log.error(`[boost] grant pipeline failed for ${member.id}:`, err);
    await releaseGrant(member.id, doneAt);
  }
}

// ─── Link-completed flow (discord_linked event) ──────────────────────────

async function handleDiscordLinked(client: Client, ev: IncomingEvent): Promise<void> {
  const userId = ev.user_id;
  const discordId = (ev.payload as Record<string, unknown>)?.discordId;
  if (typeof userId !== 'string' || typeof discordId !== 'string') return;

  const pending = await fetchPending(discordId).catch(() => []);
  if (pending.length === 0) return;

  const account = await findAccountByUserId(userId);
  if (!account) {
    log.warn(`[boost] discord_linked for user_id=${userId} but no user_settings row`);
    return;
  }

  let appliedCount = 0;
  for (const row of pending) {
    const doneAt = new Date(row.done_at);
    const path = pickPath(account);
    try {
      if (path !== 'no_extend') await applyExtension(account, path, row.reward_days);
      const { granted } = await grantBoost(discordId, doneAt, account.user_id, path);
      if (granted) appliedCount++;
      // Refresh account state — each grant may have bumped plan/expiry.
      const refreshed = await findAccountByUserId(userId);
      if (refreshed) Object.assign(account, refreshed);
    } catch (err) {
      log.error(`[boost] retroactive grant failed for ${discordId}:`, err);
      await releaseGrant(discordId, doneAt);
      break;
    }
  }

  if (appliedCount > 0) {
    await postInBoostChannel(
      client,
      retroactiveGrantMessage(discordId, appliedCount, REWARD_DAYS),
    );
    log.info(`[boost] retro-applied ${appliedCount} rewards to ${discordId}`);
  }
}

// ─── Public entry point ──────────────────────────────────────────────────

export function registerBoostReward(client: Client): void {
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const oldSince = (oldMember as GuildMember | PartialGuildMember).premiumSince ?? null;
      const newSince = newMember.premiumSince ?? null;
      if (!newSince) return; // not boosting / stopped boosting
      if (oldSince && oldSince.getTime() === newSince.getTime()) return; // unchanged
      log.info(`[boost] new boost for ${newMember.id} (premium_since=${newSince.toISOString()})`);
      await handleBoost(newMember as GuildMember, newSince, client);
    } catch (err) {
      log.error('[boost] guildMemberUpdate handler threw:', err);
    }
  });

  // Replay pending rewards once a user finally links their Discord.
  onEvent('discord_linked', async (ev) => {
    try { await handleDiscordLinked(client, ev); }
    catch (err) { log.error('[boost] discord_linked handler threw:', err); }
  });

  log.info('[boost] handler registered');
}
