/**
 * Server-boost reward handler.
 *
 * When a member starts boosting the configured guild, the bot posts a
 * thank-you message in DISCORD_BOOST_CHANNEL_ID with a "Claim my
 * reward" button addressed to that specific booster. Only the booster
 * can use the button; everyone else clicking it gets an ephemeral
 * "this isn't your reward" reply.
 *
 * On click:
 *   - If the booster has a Chessr account linked → grant 15 days,
 *     ephemeral confirmation with the email.
 *   - If not yet linked → ephemeral prompt with an "I linked my
 *     account" retry button that re-runs the same check.
 *
 * Plan branches:
 *   - free / freetrial            → set plan='premium', plan_expiry = max(now, plan_expiry) + 15d
 *   - premium (dashboard)         → plan_expiry += 15d (max(now,…))
 *   - premium (active Paddle sub) → POST /admin/paddle/extend (serveur)
 *   - lifetime / beta             → no extension, ephemeral thanks
 *
 * Idempotency: every successful grant inserts (discord_id, premium_since)
 * into the local-postgres `discord_boosts` table via the serveur's
 * /admin/boost/claim endpoint. Repeated events / clicks see the slot is
 * already taken and skip the actual extension.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  EmbedBuilder,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

const REWARD_DAYS = 15;
const ACCENT_COLOR = 0xa855f7; // Discord nitro purple
const RED = 0xef4444;

// CustomIDs are namespaced + carry the booster's discord ID + their
// premium_since (ms epoch). The premium_since lets us idempotency-key
// across re-boosts: a fresh boost gets a fresh button, the previous
// one is harmless if clicked.
const CLAIM_PREFIX = 'boost:claim';
const RETRY_PREFIX = 'boost:retry';

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

async function findAccount(discordId: string): Promise<ChessrAccount | null> {
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, plan_expiry')
    .eq('discord_id', discordId)
    .maybeSingle();
  if (!settings) return null;

  const [{ data: auth }, { data: sub }] = await Promise.all([
    supabase.auth.admin.getUserById(settings.user_id),
    supabase
      .from('subscriptions')
      .select('paddle_subscription_id, status, canceled_at')
      .eq('user_id', settings.user_id)
      .maybeSingle(),
  ]);

  return {
    user_id: settings.user_id,
    email: auth?.user?.email ?? null,
    plan: settings.plan ?? 'free',
    plan_expiry: settings.plan_expiry ?? null,
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

// ─── Serveur calls (admin-token-gated) ────────────────────────────────────

async function claimSlot(
  discordId: string,
  premiumSince: Date,
  userId: string,
  rewardPath: 'dashboard' | 'paddle' | 'no_extend',
): Promise<{ claimed: boolean; alreadyGranted: boolean }> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}/admin/boost/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({
      discordId,
      premiumSince: premiumSince.toISOString(),
      userId,
      rewardPath,
      rewardDays: REWARD_DAYS,
    }),
  });
  if (!res.ok) throw new Error(`claim HTTP ${res.status}`);
  return res.json() as Promise<{ claimed: boolean; alreadyGranted: boolean }>;
}

async function releaseSlot(discordId: string, premiumSince: Date): Promise<void> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) return;
  await fetch(`${url}/admin/boost/claim`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ discordId, premiumSince: premiumSince.toISOString() }),
  }).catch((err) => log.warn('[boost] release failed:', err));
}

async function extendPaddle(account: ChessrAccount): Promise<void> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}/admin/paddle/extend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({
      userId: account.user_id,
      days: REWARD_DAYS,
      reason: 'discord_boost',
    }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`paddle extend HTTP ${res.status}: ${json.error ?? ''}`);
  }
}

// ─── Dashboard extension (free / freetrial / non-paddle premium) ──────────

function computeNewExpiry(currentExpiry: string | null): string {
  const base = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const start = Math.max(Date.now(), base);
  return new Date(start + REWARD_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function extendDashboard(account: ChessrAccount): Promise<void> {
  const newExpiry = computeNewExpiry(account.plan_expiry);
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

  // The dashboard's events table lives on the local pg via the
  // serveur. Bot doesn't speak local pg directly — emit through the
  // /admin/events proxy so role sync + activity feed still fire.
  const { url, adminToken } = config.serveur;
  if (adminToken) {
    fetch(`${url}/admin/events`, {
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
}

// ─── UI builders ──────────────────────────────────────────────────────────

function publicEmbed(member: GuildMember): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🚀 New server boost!')
    .setDescription(
      `Thanks for boosting, <@${member.id}>! ` +
      `Click the button below to claim your **${REWARD_DAYS} days of Chessr Premium**.`,
    )
    .setColor(ACCENT_COLOR);
}

function publicClaimRow(discordId: string, premiumSinceMs: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CLAIM_PREFIX}:${discordId}:${premiumSinceMs}`)
      .setLabel(`Claim ${REWARD_DAYS} days Premium`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎁'),
  );
}

function retryRow(discordId: string, premiumSinceMs: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RETRY_PREFIX}:${discordId}:${premiumSinceMs}`)
      .setLabel('I linked my account')
      .setStyle(ButtonStyle.Primary),
  );
}

function notLinkedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Almost there')
    .setDescription(
      `You're eligible for **${REWARD_DAYS} days of Chessr Premium** — but your Chessr account isn't linked to Discord yet.\n\n` +
      'Sign in on **chessr.io**, link your Discord, then click the button below.',
    )
    .setColor(ACCENT_COLOR);
}

function thanksEmbed(account: ChessrAccount, path: 'paddle' | 'dashboard' | 'no_extend'): EmbedBuilder {
  const emailTag = account.email ? ` \`${account.email}\`` : '';
  if (path === 'paddle') {
    return new EmbedBuilder()
      .setTitle('🎉 Reward applied')
      .setDescription(
        `We extended your subscription by **${REWARD_DAYS} days**${emailTag}.\n\nThanks for boosting 💜`,
      )
      .setColor(ACCENT_COLOR);
  }
  if (path === 'no_extend') {
    return new EmbedBuilder()
      .setTitle('🎉 Already premium')
      .setDescription(
        `You already have **${account.plan}** access${emailTag} — no expiry to extend, but the boost still means a lot 💜`,
      )
      .setColor(ACCENT_COLOR);
  }
  return new EmbedBuilder()
    .setTitle('🎉 Reward applied')
    .setDescription(
      `We added **${REWARD_DAYS} days of Premium** to your Chessr account${emailTag}.\n\nThanks for boosting 💜`,
    )
    .setColor(ACCENT_COLOR);
}

// ─── Boost detection → public message ─────────────────────────────────────

async function postPublicClaim(member: GuildMember, premiumSince: Date): Promise<void> {
  const channelId = config.discord.boostChannelId;
  if (!channelId) {
    log.warn('[boost] DISCORD_BOOST_CHANNEL_ID not set — cannot post claim message');
    return;
  }
  const channel = await member.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    log.warn(`[boost] channel ${channelId} not reachable / not text-based`);
    return;
  }
  await (channel as TextChannel).send({
    content: `<@${member.id}>`,
    embeds: [publicEmbed(member)],
    components: [publicClaimRow(member.id, premiumSince.getTime())],
    allowedMentions: { users: [member.id] },
  });
}

// ─── Button handler ───────────────────────────────────────────────────────

interface ParsedButtonId {
  kind: 'claim' | 'retry';
  discordId: string;
  premiumSince: Date;
}

function parseButtonId(customId: string): ParsedButtonId | null {
  const parts = customId.split(':');
  // boost:claim:<discordId>:<ms>  or  boost:retry:<discordId>:<ms>
  if (parts.length !== 4) return null;
  if (parts[0] !== 'boost') return null;
  if (parts[1] !== 'claim' && parts[1] !== 'retry') return null;
  const ms = Number(parts[3]);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return {
    kind: parts[1] as 'claim' | 'retry',
    discordId: parts[2],
    premiumSince: new Date(ms),
  };
}

async function handleClaimClick(interaction: ButtonInteraction, parsed: ParsedButtonId): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  // Only the booster can claim — anyone else gets a friendly bounce.
  if (interaction.user.id !== parsed.discordId) {
    await interaction.editReply({
      content: `This reward is for <@${parsed.discordId}> only.`,
    });
    return;
  }

  // Verify the user is actually still boosting (matches the embedded
  // premium_since). Stops a stale message from a long-past boost being
  // claimed for a fresh reward.
  const guildId = config.discord.guildId;
  if (!guildId) {
    await interaction.editReply({ content: "Bot isn't configured for boost rewards." });
    return;
  }
  const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
  if (!member?.premiumSince || member.premiumSince.getTime() !== parsed.premiumSince.getTime()) {
    await interaction.editReply({
      content: 'This boost is no longer active or has been replaced by a newer one.',
    });
    return;
  }

  const account = await findAccount(interaction.user.id);
  if (!account) {
    await interaction.editReply({
      embeds: [notLinkedEmbed()],
      components: [retryRow(parsed.discordId, parsed.premiumSince.getTime())],
    });
    return;
  }

  // Lifetime / beta — slot taken so we don't re-prompt, but no extend.
  if (account.plan === 'lifetime' || account.plan === 'beta') {
    const r = await claimSlot(account.user_id ? interaction.user.id : interaction.user.id, parsed.premiumSince, account.user_id, 'no_extend')
      .catch((err) => { log.error('[boost] claim failed:', err); return null; });
    if (r?.alreadyGranted) {
      await interaction.editReply({ content: 'This reward was already applied.' });
      return;
    }
    await interaction.editReply({ embeds: [thanksEmbed(account, 'no_extend')] });
    return;
  }

  const path: 'paddle' | 'dashboard' = isActivePaddle(account) ? 'paddle' : 'dashboard';

  let claim: { claimed: boolean; alreadyGranted: boolean } | null = null;
  try {
    claim = await claimSlot(interaction.user.id, parsed.premiumSince, account.user_id, path);
  } catch (err) {
    log.error('[boost] claim failed:', err);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('Something went wrong')
        .setDescription("Couldn't reach the rewards service. Try again in a minute.")
        .setColor(RED)],
    });
    return;
  }

  if (claim.alreadyGranted) {
    await interaction.editReply({ content: 'This reward was already applied.' });
    return;
  }

  try {
    if (path === 'paddle') await extendPaddle(account);
    else                    await extendDashboard(account);
    await interaction.editReply({ embeds: [thanksEmbed(account, path)] });
    log.info(`[boost] granted ${REWARD_DAYS}d to ${interaction.user.id} via ${path}`);
  } catch (err) {
    // Roll the claim back so the user can retry on the next click.
    await releaseSlot(interaction.user.id, parsed.premiumSince);
    log.error(`[boost] grant failed for ${interaction.user.id}:`, err);
    const msg = err instanceof Error ? err.message : 'unknown error';
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('Reward could not be applied')
        .setDescription(`Reach out in #support and an admin will sort it: \`${msg}\``)
        .setColor(RED)],
    });
  }
}

// ─── Public entry point ───────────────────────────────────────────────────

export function registerBoostReward(client: Client): void {
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const oldSince = (oldMember as GuildMember | PartialGuildMember).premiumSince ?? null;
      const newSince = newMember.premiumSince ?? null;
      if (!newSince) return; // not boosting / stopped boosting
      if (oldSince && oldSince.getTime() === newSince.getTime()) return; // unchanged
      log.info(`[boost] new boost detected for ${newMember.id} (premium_since=${newSince.toISOString()})`);
      await postPublicClaim(newMember as GuildMember, newSince);
    } catch (err) {
      log.error('[boost] guildMemberUpdate handler threw:', err);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const parsed = parseButtonId(interaction.customId);
    if (!parsed) return;
    try {
      await handleClaimClick(interaction, parsed);
    } catch (err) {
      log.error('[boost] button handler threw:', err);
    }
  });

  log.info('[boost] handler registered');
}
