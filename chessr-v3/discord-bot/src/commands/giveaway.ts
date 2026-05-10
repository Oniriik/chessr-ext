/**
 * /giveaway — shows the caller their standing in the current giveaway:
 * tickets earned, rank among participants, prize list, ends-at.
 *
 * "Current" = soonest-ending scheduled giveaway (server picks). When
 * none exists the command says so without erroring.
 */

import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { log } from '../lib/logger.js';
import {
  discordTs,
  getCurrent,
  getMyStanding,
  prizeLabel,
} from '../lib/giveawayApi.js';

const COLOR = 0xa855f7;
const COLOR_EMPTY = 0x6b7280;

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Your standing in the current giveaway'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    let detail;
    try {
      detail = await getCurrent();
    } catch (err) {
      log.error('[giveaway] getCurrent failed:', err);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setDescription("Couldn't load the giveaway right now — try again in a moment."),
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
            .setDescription('There is no giveaway running right now. Stay tuned!'),
        ],
      });
      return;
    }

    const { giveaway, prizes, stats } = detail;

    let standing;
    try {
      standing = await getMyStanding(giveaway.id, interaction.user.id);
    } catch (err) {
      log.error('[giveaway] getMyStanding failed:', err);
      // Soft-fail to a tickets-less view rather than blocking the user
      // entirely — the prize list and ends-at are still useful.
      standing = { tickets: 0, rank: null, total_tickets: stats.tickets, total_participants: stats.participants };
    }

    const lines: string[] = [];
    lines.push(`**Ends:** ${discordTs(giveaway.ends_at, 'F')} · ${discordTs(giveaway.ends_at, 'R')}`);
    lines.push('');
    lines.push('### 🎟️ Your tickets');
    if (standing.tickets === 0) {
      lines.push('_You have no tickets yet for this giveaway._');
    } else {
      const rank = standing.rank ? `#${standing.rank}` : '—';
      lines.push(`**${standing.tickets}** ticket${standing.tickets === 1 ? '' : 's'} · rank **${rank}** of ${standing.total_participants}`);
    }
    lines.push('');
    lines.push('### 🏆 Prizes');
    if (prizes.length === 0) {
      lines.push('_No prizes configured yet._');
    } else {
      for (const p of prizes) {
        lines.push(`**#${p.position}** — ${prizeLabel(p)}`);
      }
    }
    lines.push('');
    lines.push(`_${standing.total_tickets} tickets across ${standing.total_participants} participants._`);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(`🎁 ${giveaway.name}`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Use /giveaway-leaderboard to see the top 10' }),
      ],
    });
  },
};
