import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { supabase } from '../lib/supabase.js';
import {
  eloColor,
  getLinkedAccounts,
  highestPerMode,
  MODE_CONFIG,
  platformLabel,
} from '../lib/ratings.js';
import { platformEmoji } from '../lib/platformEmoji.js';

// /rank [member] — show a member's Chessr profile + their highest
// Bullet/Blitz/Rapid rating across every linked platform (chess.com,
// lichess, worldchess). When more than one account is linked, lists
// each below the headline numbers so admins can see where the top
// rating came from.
export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show the Chessr rank of a member')
    .addUserOption((opt) =>
      opt.setName('member').setDescription('The member to check').setRequired(false),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('member') ?? interaction.user;

    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_id, plan')
      .eq('discord_id', target.id)
      .maybeSingle();

    if (!settings) {
      await interaction.editReply({
        content: `${target} hasn't linked their Chessr account yet.`,
      });
      return;
    }

    const accounts = await getLinkedAccounts(settings.user_id);
    if (accounts.length === 0) {
      await interaction.editReply({
        content: `${target} has a Chessr account but no chess platform linked.`,
      });
      return;
    }

    const top = highestPerMode(accounts);

    // Headline: max rating per mode across all platforms (consistent
    // with the v2 bot — a single Bullet/Blitz/Rapid summary).
    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: `${MODE_CONFIG.bullet.emoji} Bullet`, value: top.bullet > 0 ? `**${top.bullet}**` : 'N/A', inline: true },
      { name: `${MODE_CONFIG.blitz.emoji} Blitz`,   value: top.blitz  > 0 ? `**${top.blitz}**`  : 'N/A', inline: true },
      { name: `${MODE_CONFIG.rapid.emoji} Rapid`,   value: top.rapid  > 0 ? `**${top.rapid}**`  : 'N/A', inline: true },
    ];

    // Per-platform breakdown — only when at least 2 accounts are linked.
    // For a single account it's redundant with the headline.
    if (accounts.length >= 2) {
      const lines = accounts.map((a) => {
        const r = [
          a.rating_bullet ? `⚡${a.rating_bullet}` : null,
          a.rating_blitz  ? `🔥${a.rating_blitz}`  : null,
          a.rating_rapid  ? `🕐${a.rating_rapid}`  : null,
        ].filter(Boolean).join(' · ');
        return `${platformEmoji(a.platform)} **${platformLabel(a.platform)}** · ${a.platform_username}${r ? ` — ${r}` : ''}`;
      });
      fields.push({ name: 'Linked accounts', value: lines.join('\n') });
    } else if (accounts.length === 1) {
      const a = accounts[0];
      fields.push({
        name: 'Linked account',
        value: `${platformEmoji(a.platform)} **${platformLabel(a.platform)}** · ${a.platform_username}`,
      });
    }

    await interaction.editReply({
      embeds: [{
        title: `${target.username}'s Profile`,
        color: eloColor(top.rapid || top.blitz || top.bullet),
        fields,
        thumbnail: { url: target.displayAvatarURL({ size: 128 }) },
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Highest across linked accounts • Chessr.io',
          icon_url: 'https://chessr.io/chessr-logo.png',
        },
      }],
    });
  },
};
