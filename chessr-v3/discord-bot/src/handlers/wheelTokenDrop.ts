/**
 * Wheel-token drops — admin posts an @everyone embed in the wheel
 * channel; first user to click the button wins a wheel-spin token.
 *
 * Flow (bot side):
 *   1. Subscribe to `wheel_drop_requested` (admin clicked the dashboard
 *      button → serveur emitted the event).
 *   2. Post the @everyone message + embed (one of 5 variant copies) +
 *      a single "Catch the token" button.
 *   3. POST /admin/wheel/drop/:id/posted with the resulting messageId
 *      so the serveur can audit/repost later.
 *   4. Register a global interactionCreate handler that routes any
 *      `wheel:catch:<dropId>` button click to the serveur. The serveur
 *      runs the atomic UPDATE — exactly one caller wins. We edit the
 *      original message to show the winner + reaction time. Losers
 *      get an ephemeral "too late by …" reply.
 *
 * Race safety lives entirely in the serveur SQL (UPDATE … WHERE
 * status='open' RETURNING). The bot is allowed to fan out clicks in
 * parallel — Postgres guarantees only one of them flips the row.
 */

import {
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type TextChannel,
  ActionRowBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { onEvent } from '../lib/events.js';

const PREFIX = 'wheel:catch:';

/** Five cosmetic message variants. The serveur picks one at random
 *  per drop and ships the index in the event payload; staying in sync
 *  means edits to the wording don't require a serveur deploy. */
const VARIANTS: Array<{ title: string; description: string }> = [
  {
    title: '⚡ Quick! A wheel token just dropped',
    description: 'First click wins. **Catch it before someone else does!**',
  },
  {
    title: '🎯 Token drop incoming',
    description: 'One wheel-spin token, **first finger gets it**. Go!',
  },
  {
    title: '💎 A wheel token is up for grabs',
    description: '**Fastest click takes the token.** Don\'t blink.',
  },
  {
    title: '🔥 Surprise drop!',
    description: 'There\'s a wheel-spin token on the table. **First to claim, first to spin.**',
  },
  {
    title: '✨ Wheel-spin token, free for the taking',
    description: 'No catch — except the speed of your click. **Be the first.**',
  },
];

function buildEmbed(variant: number): EmbedBuilder {
  const v = VARIANTS[variant] ?? VARIANTS[0];
  return new EmbedBuilder()
    .setColor(0xa855f7)
    .setTitle(v.title)
    .setDescription(v.description)
    .setFooter({ text: 'Click the button below — fastest wins.' });
}

function catchButton(dropId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${dropId}`)
      .setLabel('🎟️ Catch the token')
      .setStyle(ButtonStyle.Primary),
  );
}

function buildWinnerEmbed(discordId: string, durationMs: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('✅ Caught!')
    .setDescription(`<@${discordId}> grabbed the token in **${formatDuration(durationMs)}** ⚡`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

async function serveurPost<T = unknown>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${config.serveur.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': config.serveur.adminToken,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log.warn(`[wheel-drop] ${path} replied ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.error(`[wheel-drop] ${path} fetch threw:`, err);
    return null;
  }
}

async function handleDropEvent(client: Client, payload: { dropId: number; channelId: string; variant: number }): Promise<void> {
  const { dropId, channelId, variant } = payload;
  if (!dropId || !channelId) {
    log.warn('[wheel-drop] malformed wheel_drop_requested payload, ignoring');
    return;
  }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased() || !('send' in ch)) {
    log.warn(`[wheel-drop] channel ${channelId} not reachable / not text-based`);
    return;
  }
  try {
    const message = await (ch as TextChannel).send({
      // @everyone deliberately — that's the whole point of the drop.
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
      embeds: [buildEmbed(variant)],
      components: [catchButton(dropId)],
    });
    log.info(`[wheel-drop] drop ${dropId} posted as message ${message.id} in ${channelId}`);
    await serveurPost(`/admin/wheel/drop/${dropId}/posted`, { messageId: message.id });
  } catch (err) {
    log.error('[wheel-drop] failed to post drop message:', err);
  }
}

async function handleClaimClick(i: ButtonInteraction): Promise<void> {
  const dropId = Number(i.customId.slice(PREFIX.length));
  if (!Number.isFinite(dropId)) return;

  // Ack fast so Discord doesn't time out the interaction while we
  // call the serveur. We defer the *update* path (not a reply) — that
  // way the existing message stays put until we know if we'll be
  // editing or showing an ephemeral.
  await i.deferReply({ ephemeral: true }).catch(() => undefined);

  const result = await serveurPost<{
    caught: boolean;
    tokenId?: number | null;
    durationMs?: number;
    claimedBy?: string | null;
  }>(`/admin/wheel/drop/${dropId}/claim`, { discordId: i.user.id });

  if (!result) {
    await i.editReply({ content: 'Hmm, something glitched on our end. Try again in a moment.' }).catch(() => undefined);
    return;
  }

  if (result.caught) {
    // Winner — replace the original drop embed with the result, strip
    // the button so other users see it's already gone.
    try {
      await i.message.edit({
        content: '',
        embeds: [buildWinnerEmbed(i.user.id, result.durationMs ?? 0)],
        components: [],
      });
    } catch (err) {
      log.warn('[wheel-drop] failed to edit winner message:', err);
    }
    await i.editReply({
      content: `🎟️ Token in your inventory. Run \`/inventory\` to spin it!`,
    }).catch(() => undefined);
    return;
  }

  // Lost the race. Ephemeral consolation — only this user sees it.
  const claimedBy = result.claimedBy;
  const msg = claimedBy
    ? `Too late — <@${claimedBy}> already caught it.`
    : 'Too late — the token is already gone.';
  await i.editReply({ content: msg }).catch(() => undefined);
}

export function registerWheelTokenDrop(client: Client): void {
  // Bot listens for the admin-triggered drop on the shared event bus.
  onEvent('wheel_drop_requested', (e) => {
    handleDropEvent(client, e.payload as { dropId: number; channelId: string; variant: number })
      .catch((err) => log.error('[wheel-drop] drop handler threw:', err));
  });

  // Global button handler. Filter early on the customId prefix so we
  // don't shadow any other handler.
  client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith(PREFIX)) return;
    try {
      await handleClaimClick(interaction);
    } catch (err) {
      log.error('[wheel-drop] click handler threw:', err);
    }
  });

  log.info('[wheel-drop] handler registered');
}
