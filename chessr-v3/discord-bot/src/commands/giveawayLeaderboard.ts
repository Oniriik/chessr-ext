/**
 * /giveaway-leaderboard — public top 10 for the current giveaway.
 * Targets whichever giveaway is currently scheduled with the soonest
 * ends_at. When none exists the command says so cleanly.
 */

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { log } from '../lib/logger.js';
import { discordTs, getCurrent, getLeaderboard } from '../lib/giveawayApi.js';

const COLOR = 0xa855f7;
const COLOR_EMPTY = 0x6b7280;

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('giveaway-leaderboard')
    .setDescription('Top 10 ticket holders for the current giveaway'),

  async execute(interaction) {
    // Public — no ephemeral here, the leaderboard is meant to be shown.
    await interaction.deferReply();

    let detail;
    try {
      detail = await getCurrent();
    } catch (err) {
      log.error('[giveaway-leaderboard] getCurrent failed:', err);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setDescription("Couldn't load the giveaway leaderboard — try again in a moment."),
        ],
      });
      return;
    }

    if (!detail) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_EMPTY)
            .setTitle('🎁 No active giveaway')
            .setDescription('There is no giveaway running right now.'),
        ],
      });
      return;
    }

    const { giveaway } = detail;
    let rows;
    try {
      rows = await getLeaderboard(giveaway.id, 10);
    } catch (err) {
      log.error('[giveaway-leaderboard] getLeaderboard failed:', err);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setDescription("Couldn't load the leaderboard — try again in a moment."),
        ],
      });
      return;
    }

    if (rows.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_EMPTY)
            .setTitle(`🎁 ${giveaway.name}`)
            .setDescription('No tickets have been earned yet — be the first!')
            .setFooter({ text: `Ends ${new Date(giveaway.ends_at).toUTCString()}` }),
        ],
      });
      return;
    }

    // Pre-fetch members so @mentions resolve client-side (same trick as
    // the chess /leaderboard).
    if (interaction.guild) {
      await interaction.guild.members
        .fetch({ user: rows.map((r) => r.discord_id) })
        .catch(() => {});
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => {
      const prefix = i < 3 ? medals[i] : `\`${i + 1}.\``;
      return `${prefix} <@${r.discord_id}> — **${r.tickets}** ticket${r.tickets === 1 ? '' : 's'}`;
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(`🎁 ${giveaway.name} — Top 10`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Use /giveaway to see your standing' })
          .addFields({ name: 'Ends', value: discordTs(giveaway.ends_at, 'F'), inline: false }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};
