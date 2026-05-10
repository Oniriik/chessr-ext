/**
 * Giveaway announcer + Register button handler.
 *
 * Two pieces, registered together because they share state:
 *
 *  1) Ticker — every 30s, ask the serveur for scheduled giveaways
 *     whose starts_at has elapsed and that haven't been announced yet.
 *     For each, post the embed + Register button to the configured
 *     channel and mark the row as announced (atomic on the serveur, so
 *     restarting the bot can't double-post).
 *
 *  2) Button — `gw:register:<giveawayId>` on the announcement embed.
 *     Click → register the user, ephemeral reply with their new ticket
 *     count + how to earn more.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  EmbedBuilder,
  type Interaction,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import {
  type PendingAnnounce,
  discordTs,
  getPendingAnnounce,
  markAnnounced,
  prizeLabel,
  registerForGiveaway,
} from '../lib/giveawayApi.js';

const TICK_MS = 30_000;
const COLOR_GW = 0xa855f7;
const COLOR_OK = 0x10b981;
const COLOR_ERR = 0xef4444;

const REGISTER_PREFIX = 'gw:register:';
const registerCustomId = (id: number) => `${REGISTER_PREFIX}${id}`;

function announcementEmbed(g: PendingAnnounce): EmbedBuilder {
  const lines: string[] = [];
  lines.push(`**Ends:** ${discordTs(g.ends_at, 'F')} · ${discordTs(g.ends_at, 'R')}`);
  lines.push('');
  lines.push('### 🏆 Prizes');
  if (g.prizes.length === 0) {
    lines.push('_No prizes configured._');
  } else {
    for (const p of g.prizes) {
      lines.push(`**#${p.position}** — ${prizeLabel(p)}`);
    }
  }
  lines.push('');
  lines.push('### 🎟️ How to earn tickets');
  lines.push('• **Register** below → +1 ticket');
  lines.push('• Invite friends to the server → +1 ticket per join (during the giveaway period)');
  lines.push('');
  lines.push('Use `/giveaway` to see your standing · `/giveaway-leaderboard` for the top 10.');

  return new EmbedBuilder()
    .setColor(COLOR_GW)
    .setTitle(`🎁 ${g.name}`)
    .setDescription(lines.join('\n'));
}

function registerRow(giveawayId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(registerCustomId(giveawayId))
      .setLabel('Register')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Primary),
  );
}

async function postAnnouncement(client: Client, g: PendingAnnounce): Promise<void> {
  const channelId = g.announce_channel_id ?? config.discord.giveawayChannelId;
  if (!channelId) {
    log.warn(`[giveaway-announce] no channel for giveaway ${g.id} (set DISCORD_GIVEAWAY_CHANNEL_ID or per-giveaway override)`);
    return;
  }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased() || !('send' in ch)) {
    log.warn(`[giveaway-announce] channel ${channelId} not reachable / not text-based`);
    return;
  }

  const sent = await (ch as TextChannel).send({
    embeds: [announcementEmbed(g)],
    components: [registerRow(g.id)],
  });

  // Mark as announced AFTER the send succeeds — if the API call fails
  // we'll re-post on the next tick, which is safer than ending up with
  // a row that says "announced" but no message in Discord.
  try {
    await markAnnounced(g.id, sent.id, channelId);
    log.info(`[giveaway-announce] posted giveaway ${g.id} → ${channelId}/${sent.id}`);
  } catch (err) {
    log.error('[giveaway-announce] markAnnounced failed:', err);
  }
}

async function tick(client: Client): Promise<void> {
  let pending: PendingAnnounce[];
  try {
    pending = await getPendingAnnounce();
  } catch (err) {
    log.error('[giveaway-announce] poll failed:', err);
    return;
  }
  for (const g of pending) {
    try { await postAnnouncement(client, g); }
    catch (err) { log.error(`[giveaway-announce] post failed for ${g.id}:`, err); }
  }
}

export function registerGiveawayAnnouncer(client: Client): void {
  // Kick off the loop. Don't await the first tick — boot stays
  // fast, we don't care if the first poll catches anything.
  setInterval(() => { void tick(client); }, TICK_MS);
  // Also run once shortly after boot so a fresh start doesn't have to
  // wait the full interval to catch up.
  setTimeout(() => { void tick(client); }, 5_000);

  client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith(REGISTER_PREFIX)) return;
    try { await handleRegister(interaction); }
    catch (err) { log.error('[giveaway-announce] register handler failed:', err); }
  });
}

async function handleRegister(interaction: ButtonInteraction): Promise<void> {
  const giveawayId = Number(interaction.customId.slice(REGISTER_PREFIX.length));
  if (!Number.isFinite(giveawayId)) return;

  await interaction.deferReply({ ephemeral: true });

  let result;
  try {
    result = await registerForGiveaway(giveawayId, interaction.user.id);
  } catch (err) {
    log.error('[giveaway-announce] register API failed:', err);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription("Couldn't register — try again in a moment.")],
    });
    return;
  }

  if (result.error === 'not_started') {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription("This giveaway hasn't started yet.")],
    });
    return;
  }
  if (result.error === 'ended' || result.error === 'giveaway_locked') {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription('This giveaway is closed.')],
    });
    return;
  }
  if (result.error || !result.registered) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription('Registration failed.')],
    });
    return;
  }

  if (result.already) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_OK)
          .setDescription('You\'re already registered. Use `/giveaway` to see your standing.'),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_OK)
        .setTitle('🎟️ Registered!')
        .setDescription(
          'You earned **+1 ticket** for joining.\n' +
          'Invite friends to the server during the giveaway period to earn more.\n\n' +
          'Use `/giveaway` to see your standing.',
        ),
    ],
  });
}
