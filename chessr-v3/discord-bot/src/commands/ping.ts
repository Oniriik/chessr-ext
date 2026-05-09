import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../lib/commands.js';

// Health-check slash command — confirms the bot is alive and that
// command registration + interaction dispatch are wired correctly.
// Reports the gateway round-trip latency since it's free here.
export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is alive'),
  execute: async (interaction) => {
    const sent = await interaction.reply({ content: 'Pinging…', fetchReply: true, ephemeral: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const ws = interaction.client.ws.ping;
    await interaction.editReply(`Pong — round-trip ${latency}ms · gateway ${ws}ms`);
  },
};
