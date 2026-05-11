/**
 * Event forwarder — subscribes to the chessr:events Redis bus and routes
 * each event to the matching mod channel as a Discord embed.
 *
 * Routing table (see also the design doc in the chat thread):
 *
 *   #subscriptions
 *     new_customer · customer_renewed · customer_canceled · payment_failed
 *     freetrial_claimed · wheel_claim (lifetime only) · giveaway_drawn
 *     (only when at least one lifetime winner)
 *
 *   #users
 *     signup_success · chess_account_linked · chess_account_unlinked
 *     discord_linked · discord_unlinked
 *     giveaway_ticket_earned (admin_grant source only)
 *
 *   #security-alerts
 *     signup_blocked · login_blocked · user_banned · user_unbanned
 *     user_deleted · email_changed
 *
 * Unset channel IDs → silent skip. Failed sends are logged but don't
 * crash the event subscriber.
 */

import {
  type Client,
  EmbedBuilder,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { onEvent, type IncomingEvent } from '../lib/events.js';
import { supabase } from '../lib/supabase.js';

// ─── Embed colors ───────────────────────────────────────────────────────

const COLOR = {
  success: 0x10b981, // green — new customer, renewal, unbanned
  info:    0x3b82f6, // blue — signups, links
  warn:    0xf59e0b, // amber — cancel, payment failed
  danger:  0xef4444, // red — bans, blocked attempts
  purple:  0xa855f7, // wheel / giveaway
  amber:   0xfbbf24, // lifetime
  muted:   0x71717a, // unlinks
};

// ─── Plan formatting helper ─────────────────────────────────────────────

function formatPlan(plan: string | null | undefined): string {
  if (!plan) return 'Free';
  if (plan === 'lifetime') return 'Lifetime';
  if (plan === 'premium')  return 'Premium';
  if (plan === 'freetrial') return 'Free Trial';
  return plan;
}

function formatInterval(interval: string | null | undefined): string {
  if (!interval) return '';
  return ` ${interval}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ts = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${ts}:f>`;
}

// ─── Lookups ─────────────────────────────────────────────────────────────

/** Resolve a chessr user_id to { email, plan, discord_id } via Supabase.
 *  Used by every event that carries a chessr user_id rather than a
 *  Discord id directly. Returns null on lookup failure so callers can
 *  fall back to "user <id>" formatting. */
async function fetchUserContext(userId: string | null): Promise<
  { email: string | null; plan: string | null; discordId: string | null } | null
> {
  if (!userId) return null;
  try {
    const [{ data: settings }, { data: authData }] = await Promise.all([
      supabase
        .from('user_settings')
        .select('plan, discord_id')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase.auth.admin.getUserById(userId),
    ]);
    return {
      email: authData?.user?.email ?? null,
      plan:  settings?.plan ?? null,
      discordId: settings?.discord_id ?? null,
    };
  } catch (err) {
    log.warn('[forwarder] fetchUserContext failed:', err);
    return null;
  }
}

/** Mention or fallback to email. Falls back to "user <short id>" if
 *  neither is available — keeps the embed readable. */
function mention(ctx: { email: string | null; discordId: string | null } | null, userId: string | null): string {
  if (ctx?.discordId) return `<@${ctx.discordId}>`;
  if (ctx?.email) return `**${ctx.email}**`;
  if (userId) return `user \`${userId.slice(0, 8)}\``;
  return 'an anonymous user';
}

// ─── Channel send helper ────────────────────────────────────────────────

async function sendEmbed(
  client: Client,
  channelId: string | undefined,
  embed: EmbedBuilder,
  content?: string,
): Promise<void> {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased() || !('send' in ch)) {
      log.warn(`[forwarder] channel ${channelId} not reachable / not text-based`);
      return;
    }
    await (ch as TextChannel).send({ content, embeds: [embed] });
  } catch (err) {
    log.warn(`[forwarder] send to ${channelId} failed:`, err);
  }
}

// ─── #subscriptions handlers ────────────────────────────────────────────

async function onNewCustomer(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const plan = String(e.payload.plan ?? '');
  const interval = (e.payload.interval as string | null) ?? null;
  const newExpiry = e.payload.newExpiry as string | null;

  const embed = new EmbedBuilder()
    .setColor(plan === 'lifetime' ? COLOR.amber : COLOR.success)
    .setTimestamp(new Date());

  if (plan === 'lifetime') {
    embed
      .setTitle('🌟 New Lifetime customer')
      .setDescription(`${m} purchased **Lifetime** — welcome to the family.`);
  } else {
    embed
      .setTitle('💎 New customer')
      .setDescription(
        `${m} just subscribed to **${formatPlan(plan)}${formatInterval(interval)}**` +
        (newExpiry ? `\nFirst renewal: ${formatDate(newExpiry)}` : ''),
      );
  }
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

async function onCustomerRenewed(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const plan = String(e.payload.plan ?? 'Premium');
  const interval = (e.payload.interval as string | null) ?? null;
  const newExpiry = e.payload.newExpiry as string | null;

  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle('🔄 Renewal')
    .setDescription(
      `${m}'s **${formatPlan(plan)}${formatInterval(interval)}** renewed.\n` +
      `Next bill: ${formatDate(newExpiry)}`,
    )
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

async function onCustomerCanceled(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const plan = String(e.payload.plan ?? 'Premium');
  const interval = (e.payload.interval as string | null) ?? null;
  const expiresAt = e.payload.expiresAt as string | null;
  const scheduled = e.payload.scheduled === true;

  const embed = new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle('⛔ Subscription canceled')
    .setDescription(
      `${m} canceled **${formatPlan(plan)}${formatInterval(interval)}**.\n` +
      (scheduled
        ? `Still has access until ${formatDate(expiresAt)}.`
        : `Cancellation is immediate.`),
    )
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

async function onPaymentFailed(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const plan = String(e.payload.plan ?? 'Premium');
  const expiresAt = e.payload.expiresAt as string | null;

  const embed = new EmbedBuilder()
    .setColor(COLOR.danger)
    .setTitle('⚠️ Payment failed')
    .setDescription(
      `Card declined for ${m} (**${formatPlan(plan)}**).\n` +
      `Paddle will retry automatically; access until ${formatDate(expiresAt)} if it can't recover.`,
    )
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

async function onFreetrialClaimed(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const days = Number(e.payload.durationDays ?? 0);
  const expiresAt = e.payload.expiresAt as string | null;

  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('🆓 Free trial claimed')
    .setDescription(
      `${m} started a **${days}-day** free trial.\n` +
      `Expires ${formatDate(expiresAt)}`,
    )
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

async function onWheelClaim(client: Client, e: IncomingEvent) {
  // Only post lifetime claims to subscriptions — days claims are normal
  // self-service flows.
  if (e.payload.rewardKind !== 'lifetime') return;
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const rewardId = e.payload.rewardId;
  const embed = new EmbedBuilder()
    .setColor(COLOR.amber)
    .setTitle('🌟 Lifetime wheel claim')
    .setDescription(
      `${m} claimed a **Lifetime** wheel reward.\n` +
      `Manual delivery required — open a ticket with reward id \`#${rewardId}\`.`,
    )
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

async function onGiveawayDrawn(client: Client, e: IncomingEvent) {
  // Only forward if the giveaway awarded at least one lifetime prize —
  // those require manual delivery. Token / premium-days prizes are
  // auto-applied via wheel_rewards and don't need a mod ping.
  const winners = (e.payload.winners as Array<{
    discordId: string | null;
    prize: { prize_kind: string; plan_kind?: string | null };
  }> | undefined) ?? [];
  const lifetimeWinners = winners.filter(
    (w) => w.discordId && w.prize.prize_kind === 'plan' && w.prize.plan_kind === 'lifetime',
  );
  if (lifetimeWinners.length === 0) return;

  const name = String(e.payload.name ?? 'giveaway');
  const userList = lifetimeWinners.map((w) => `<@${w.discordId}>`).join(', ');
  const embed = new EmbedBuilder()
    .setColor(COLOR.amber)
    .setTitle('🏆 Lifetime giveaway winners')
    .setDescription(
      `Giveaway **${name}** drew **${lifetimeWinners.length}** lifetime winner${lifetimeWinners.length === 1 ? '' : 's'}:\n` +
      `${userList}\n\nManual delivery required.`,
    )
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.subscriptions, embed);
}

// ─── #users handlers ────────────────────────────────────────────────────

async function onSignupSuccess(client: Client, e: IncomingEvent) {
  const email = String(e.payload.email ?? '?');
  const country = String(e.payload.country ?? '');
  const countryCode = String(e.payload.countryCode ?? '').toUpperCase();
  const flag = countryCode
    ? countryCode.split('').map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('')
    : '';
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle('🎉 New signup')
    .setDescription(`**${email}**${flag ? ` · ${flag} ${country}` : ''}`)
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

async function onChessAccountLinked(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const platform = String(e.payload.platform ?? '');
  const username = String(e.payload.platform_username ?? '');
  const bullet = (e.payload.rating_bullet as number | null) ?? null;
  const blitz  = (e.payload.rating_blitz  as number | null) ?? null;
  const rapid  = (e.payload.rating_rapid  as number | null) ?? null;
  const ratings = [
    bullet && `🎯 ${bullet}`,
    blitz  && `⚡ ${blitz}`,
    rapid  && `⏱️ ${rapid}`,
  ].filter(Boolean).join(' · ');
  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('♟️ Chess account linked')
    .setDescription(
      `${m} linked their **${platform}** account \`@${username}\`` +
      (ratings ? `\n${ratings}` : ''),
    )
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

async function onChessAccountUnlinked(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const platform = String(e.payload.platform ?? '');
  const username = String(e.payload.platform_username ?? '');
  const embed = new EmbedBuilder()
    .setColor(COLOR.muted)
    .setTitle('♟️ Chess account unlinked')
    .setDescription(`${m} unlinked their **${platform}** account \`@${username}\``)
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

async function onChessAccountBanned(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const platform = String(e.payload.platform ?? '');
  const username = String(e.payload.platform_username ?? '');
  // chess.com profile URL — 404 here too, but useful for moderators to
  // confirm and decide whether to nudge the user to relink.
  const profileUrl = platform === 'chesscom'
    ? `https://www.chess.com/member/${username}`
    : platform === 'lichess'
      ? `https://lichess.org/@/${username}`
      : null;
  const embed = new EmbedBuilder()
    .setColor(COLOR.danger)
    .setTitle('🚫 Chess account closed / banned')
    .setDescription(
      `${m}'s **${platform}** account \`@${username}\` likely closed by the platform or username change` +
      (profileUrl ? `\n[Open profile](${profileUrl})` : ''),
    )
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

async function onDiscordLinked(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const discordId = String(e.payload.discordId ?? ctx?.discordId ?? '');
  const m = ctx?.email ? `**${ctx.email}**` : (e.user_id ? `user \`${e.user_id.slice(0, 8)}\`` : 'an account');
  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('💬 Discord linked')
    .setDescription(
      `${m} linked Discord` + (discordId ? ` <@${discordId}>` : ''),
    )
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

async function onDiscordUnlinked(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = ctx?.email ? `**${ctx.email}**` : (e.user_id ? `user \`${e.user_id.slice(0, 8)}\`` : 'an account');
  const embed = new EmbedBuilder()
    .setColor(COLOR.muted)
    .setTitle('💬 Discord unlinked')
    .setDescription(`${m} unlinked Discord`)
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

async function onGiveawayTicketEarned(client: Client, e: IncomingEvent) {
  // Only admin grants — invites + registrations are too noisy for a
  // mod channel. The dashboard's giveaway page is the source of truth
  // for self-service signals.
  if (e.payload.source !== 'admin_grant') return;
  const discordId = String(e.payload.discordId ?? '');
  const count = Number(e.payload.count ?? 0);
  const reason = (e.payload.reason as string | null) ?? null;

  // Discord renders <@id> as the user's display name + avatar, so the
  // raw mention is enough — no need to resolve the username separately.
  const display = `<@${discordId}>`;

  const embed = new EmbedBuilder()
    .setColor(COLOR.purple)
    .setTitle('🎟️ Tickets granted')
    .setDescription(
      `${display} was granted **${count}** ticket${count === 1 ? '' : 's'}` +
      (reason ? ` — reason: _${reason}_` : ''),
    )
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.users, embed);
}

// ─── #security-alerts handlers ──────────────────────────────────────────

async function onSignupBlocked(client: Client, e: IncomingEvent) {
  const email = String(e.payload.email ?? '?');
  const reason = String(e.payload.reason ?? 'unknown');
  const country = e.payload.country as string | undefined;
  const ip = e.payload.ip as string | undefined;
  const embed = new EmbedBuilder()
    .setColor(COLOR.danger)
    .setTitle('🚫 Signup blocked')
    .setDescription(`**${email}** — reason: **${reason}**`)
    .setTimestamp(new Date());
  if (country) embed.addFields({ name: 'Country', value: country, inline: true });
  if (ip)      embed.addFields({ name: 'IP',      value: `\`${ip}\``, inline: true });
  await sendEmbed(client, config.discord.mod.security, embed);
}

async function onLoginBlocked(client: Client, e: IncomingEvent) {
  const email = String(e.payload.email ?? '?');
  const banReason = (e.payload.banReason as string | undefined) ?? null;
  const embed = new EmbedBuilder()
    .setColor(COLOR.danger)
    .setTitle('🚫 Banned user login attempt')
    .setDescription(`**${email}**${banReason ? `\nBan reason: _${banReason}_` : ''}`)
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.security, embed);
}

async function onUserBanned(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const reason = (e.payload.reason as string | undefined) ?? null;
  const embed = new EmbedBuilder()
    .setColor(COLOR.danger)
    .setTitle('🔨 User banned')
    .setDescription(`${m}${reason ? `\nReason: _${reason}_` : ''}`)
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.security, embed);
}

async function onUserUnbanned(client: Client, e: IncomingEvent) {
  const ctx = await fetchUserContext(e.user_id);
  const m = mention(ctx, e.user_id);
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle('✅ User unbanned')
    .setDescription(`${m}`)
    .setTimestamp(new Date());
  if (ctx?.email) embed.addFields({ name: 'Email', value: ctx.email, inline: true });
  await sendEmbed(client, config.discord.mod.security, embed);
}

async function onUserDeleted(client: Client, e: IncomingEvent) {
  // user_settings is gone by the time this fires — only the actor id
  // is reliably available. The payload carries previousPlan.
  const previousPlan = (e.payload.previousPlan as string | undefined) ?? 'free';
  const idShort = e.user_id ? e.user_id.slice(0, 8) : 'unknown';
  const embed = new EmbedBuilder()
    .setColor(COLOR.muted)
    .setTitle('🗑️ Account deleted')
    .setDescription(`User \`${idShort}\` deleted their account (was on **${formatPlan(previousPlan)}**).`)
    .setTimestamp(new Date());
  await sendEmbed(client, config.discord.mod.security, embed);
}

async function onEmailChanged(client: Client, e: IncomingEvent) {
  const oldEmail = String(e.payload.oldEmail ?? '?');
  const newEmail = String(e.payload.newEmail ?? '?');
  const ctx = await fetchUserContext(e.user_id);
  const embed = new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle('📧 Email changed')
    .setDescription(`\`${oldEmail}\` → **${newEmail}**`)
    .setTimestamp(new Date());
  if (ctx?.discordId) embed.addFields({ name: 'Discord', value: `<@${ctx.discordId}>`, inline: true });
  await sendEmbed(client, config.discord.mod.security, embed);
}

// ─── Wire up ─────────────────────────────────────────────────────────────

export function registerEventForwarder(client: Client): void {
  // #subscriptions
  onEvent('new_customer',      (e) => onNewCustomer(client, e));
  onEvent('customer_renewed',  (e) => onCustomerRenewed(client, e));
  onEvent('customer_canceled', (e) => onCustomerCanceled(client, e));
  onEvent('payment_failed',    (e) => onPaymentFailed(client, e));
  onEvent('freetrial_claimed', (e) => onFreetrialClaimed(client, e));
  onEvent('wheel_claim',       (e) => onWheelClaim(client, e));
  onEvent('giveaway_drawn',    (e) => onGiveawayDrawn(client, e));

  // #users
  onEvent('signup_success',          (e) => onSignupSuccess(client, e));
  onEvent('chess_account_linked',    (e) => onChessAccountLinked(client, e));
  onEvent('chess_account_unlinked',  (e) => onChessAccountUnlinked(client, e));
  onEvent('chess_account_banned',    (e) => onChessAccountBanned(client, e));
  onEvent('discord_linked',          (e) => onDiscordLinked(client, e));
  onEvent('discord_unlinked',        (e) => onDiscordUnlinked(client, e));
  onEvent('giveaway_ticket_earned',  (e) => onGiveawayTicketEarned(client, e));

  // #security-alerts
  onEvent('signup_blocked',  (e) => onSignupBlocked(client, e));
  onEvent('login_blocked',   (e) => onLoginBlocked(client, e));
  onEvent('user_banned',     (e) => onUserBanned(client, e));
  onEvent('user_unbanned',   (e) => onUserUnbanned(client, e));
  onEvent('user_deleted',    (e) => onUserDeleted(client, e));
  onEvent('email_changed',   (e) => onEmailChanged(client, e));

  log.info('[forwarder] mod-channel event routing registered');
}
