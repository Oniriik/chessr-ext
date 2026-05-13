/**
 * /token <user> <count> [reason] — super-admin-only wheel-token gift.
 *
 * Mints `count` admin_grant wheel tokens for the target via the serveur
 * (POST /admin/wheel/token/grant), then DMs the recipient with their new
 * balance. Falls back to a public ping in the boost channel if DMs are
 * closed — same pattern as the /inventory gift flow.
 */

import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { resolveRoleByDiscordId } from '../lib/roleCheck.js';
import { supabase } from '../lib/supabase.js';

const COLOR_GIFT = 0xfacc15;

interface GrantResponse { granted: number; tokenIds: number[] }
interface InventoryResponse {
  tokens: Array<{ id: number; source: string; earned_at: string }>;
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, adminToken } = config.serveur;
  if (!adminToken) throw new Error('SERVEUR_ADMIN_TOKEN missing');
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('token')
    .setDescription('Gift wheel tokens to a user (super-admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Recipient').setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt.setName('count')
        .setDescription('How many tokens to grant (1–100)')
        .setMinValue(1).setMaxValue(100).setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Audit reason (optional)'),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // Server-side role check — the .setDefaultMemberPermissions above is
    // only a UX hint, this is the authoritative gate.
    const role = await resolveRoleByDiscordId(interaction.user.id);
    if (role !== 'super_admin') {
      await interaction.editReply({ content: '❌ super_admin required.' });
      return;
    }

    const target = interaction.options.getUser('user', true);
    const count  = interaction.options.getInteger('count', true);
    const reason = interaction.options.getString('reason')
      ?? `Gift via /token by ${interaction.user.tag}`;

    if (target.bot) {
      await interaction.editReply({ content: "❌ Can't gift tokens to a bot." });
      return;
    }

    // Resolve actor's chessr user_id for the audit event payload.
    // Best-effort: a missing link just leaves actor_id null on the event.
    let actorUserId: string | undefined;
    try {
      const { data } = await supabase
        .from('user_settings')
        .select('user_id')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();
      actorUserId = data?.user_id ?? undefined;
    } catch { /* leave undefined */ }

    // Mint the tokens.
    let granted: number;
    try {
      const res = await adminFetch<GrantResponse>('/admin/wheel/token/grant', {
        method: 'POST',
        body: JSON.stringify({
          discordId: target.id,
          count,
          reason,
          actorUserId,
        }),
      });
      granted = res.granted;
    } catch (err) {
      log.error('[token] grant failed:', err);
      await interaction.editReply({ content: '❌ Could not grant tokens — see bot logs.' });
      return;
    }

    // Read recipient's current unspun balance (post-grant).
    let balance = 0;
    try {
      const inv = await adminFetch<InventoryResponse>(
        `/admin/wheel/inventory?discordId=${encodeURIComponent(target.id)}`,
      );
      balance = inv.tokens.length;
    } catch (err) {
      log.warn('[token] balance lookup failed:', err);
    }

    const grantedWord = granted === 1 ? 'token' : 'tokens';
    const balanceWord = balance === 1 ? 'token' : 'tokens';

    // DM the recipient — the primary notification.
    let dmSent = false;
    try {
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_GIFT)
            .setTitle("🎟️ You've been gifted wheel tokens!")
            .setDescription(
              `You have been gifted **${granted} ${grantedWord}**.\n` +
              `Current balance: **${balance} ${balanceWord}** available.\n\n` +
              'Use `/inventory` to spin the wheel.',
            ),
        ],
      });
      dmSent = true;
    } catch (err) {
      // DM blocked by user (or shared no guild — shouldn't happen here).
      log.warn(`[token] DM to ${target.id} failed:`, err);
    }

    // Fallback: public ping in the boost channel — same approach as the
    // /inventory gift flow when DMs are closed.
    if (!dmSent) {
      const channelId = config.discord.boostChannelId;
      if (channelId) {
        try {
          const ch = await interaction.client.channels.fetch(channelId);
          if (ch && ch.isTextBased() && 'send' in ch) {
            await (ch as TextChannel).send({
              content: `<@${target.id}>`,
              embeds: [
                new EmbedBuilder()
                  .setColor(COLOR_GIFT)
                  .setDescription(
                    `🎟️ <@${target.id}>, you've been gifted **${granted} ${grantedWord}**! ` +
                    `Current balance: **${balance} ${balanceWord}**. ` +
                    'Use `/inventory` to spin.',
                  ),
              ],
              allowedMentions: { users: [target.id] },
            });
          }
        } catch (err) {
          log.warn('[token] public fallback ping failed:', err);
        }
      }
    }

    const notifLine = dmSent ? 'DM sent ✅' : 'DM closed — public ping fallback used';
    await interaction.editReply({
      content:
        `✅ Granted **${granted} ${grantedWord}** to <@${target.id}>.\n` +
        `Their balance is now **${balance} ${balanceWord}**.\n` +
        `${notifLine}`,
    });
  },
};
