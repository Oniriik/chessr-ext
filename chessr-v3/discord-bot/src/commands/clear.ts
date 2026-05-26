/**
 * /clear <number> — delete the last N messages in the current channel.
 *
 * Requires Manage Messages. Uses bulkDelete for recent messages (< 14 days)
 * and falls back to individual deletes for older ones.
 * Reply is ephemeral so the confirmation doesn't pollute the channel.
 */

import { PermissionFlagsBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { log } from '../lib/logger.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete the last N messages in this channel (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) =>
      opt
        .setName('number')
        .setDescription('Number of messages to delete (1–100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    ) as unknown as SlashCommandBuilder,

  execute: async (interaction) => {
    await interaction.deferReply({ ephemeral: true });

    const count = interaction.options.getInteger('number', true);
    const channel = interaction.channel;

    if (!channel || !channel.isTextBased() || !('bulkDelete' in channel)) {
      await interaction.editReply('This command only works in text channels.');
      return;
    }

    const textChannel = channel as TextChannel;
    const messages = await textChannel.messages.fetch({ limit: count });

    const cutoff = Date.now() - FOURTEEN_DAYS_MS;
    const recent = messages.filter((m) => m.createdTimestamp > cutoff);
    const old    = messages.filter((m) => m.createdTimestamp <= cutoff);

    let deleted = 0;

    // bulkDelete requires at least 2 messages; handle 1 separately
    if (recent.size >= 2) {
      const result = await textChannel.bulkDelete(recent, true);
      deleted += result.size;
    } else if (recent.size === 1) {
      await recent.first()!.delete().catch(() => {});
      deleted += 1;
    }

    // Individually delete messages older than 14 days (bulk can't touch them)
    for (const msg of old.values()) {
      await msg.delete().catch(() => {});
      deleted++;
    }

    log.info(`[clear] ${interaction.user.tag} deleted ${deleted}/${count} messages in #${textChannel.name}`);

    const skipped = count - messages.size; // channel had fewer messages than requested
    const note = skipped > 0 ? ` (only ${messages.size} found in channel)` : '';
    await interaction.editReply(`Deleted ${deleted} message${deleted !== 1 ? 's' : ''}${note}.`);
  },
};
