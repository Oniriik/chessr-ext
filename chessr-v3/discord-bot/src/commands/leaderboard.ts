import { SlashCommandBuilder } from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { supabase } from '../lib/supabase.js';
import { MODE_CONFIG, type Mode } from '../lib/ratings.js';
import { platformEmoji } from '../lib/platformEmoji.js';

// /leaderboard [mode] — top 10 by Bullet/Blitz/Rapid Elo across all
// linked platforms (chess.com, lichess, worldchess). One row per
// chessr user, taking the max rating among that user's linked accounts
// — same shape as the v2 bot.
//
// Algorithm:
//   1. Fetch all user_settings with a discord_id.
//   2. Pull (user_id, <column>, platform) for every active linked
//      account belonging to those users.
//   3. Reduce to a single max-rating per user.
//   4. Sort desc, take top 10.
export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 players by ELO')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Time control (default: rapid)')
        .setRequired(false)
        .addChoices(
          { name: 'Rapid',  value: 'rapid'  },
          { name: 'Blitz',  value: 'blitz'  },
          { name: 'Bullet', value: 'bullet' },
        ),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction) {
    await interaction.deferReply();

    const mode = (interaction.options.getString('mode') ?? 'rapid') as Mode;
    const { emoji, label, column } = MODE_CONFIG[mode];

    const { data: linkedUsers } = await supabase
      .from('user_settings')
      .select('user_id, discord_id, discord_username')
      .not('discord_id', 'is', null);

    if (!linkedUsers || linkedUsers.length === 0) {
      await interaction.editReply({ content: 'No linked players yet.' });
      return;
    }

    const userIds = linkedUsers.map((u) => u.user_id as string);
    const { data: accounts } = await supabase
      .from('linked_accounts')
      .select(`user_id, platform, ${column}`)
      .in('user_id', userIds)
      .is('unlinked_at', null);

    // Reduce to max-elo per user; remember which platform that max came
    // from so we can show a tiny tag on each row.
    const peakByUser = new Map<string, { elo: number; platform: string }>();
    for (const a of (accounts ?? []) as Array<Record<string, unknown>>) {
      const userId = a.user_id as string;
      const elo = (a[column] as number | null) ?? 0;
      if (elo <= 0) continue;
      const cur = peakByUser.get(userId);
      if (!cur || elo > cur.elo) {
        peakByUser.set(userId, { elo, platform: a.platform as string });
      }
    }

    const rows = linkedUsers
      .map((u) => {
        const peak = peakByUser.get(u.user_id as string);
        return peak
          ? {
              discordId: u.discord_id as string,
              elo: peak.elo,
              platform: peak.platform,
            }
          : null;
      })
      .filter((r): r is { discordId: string; elo: number; platform: string } => r !== null)
      .sort((a, b) => b.elo - a.elo)
      .slice(0, 10);

    if (rows.length === 0) {
      await interaction.editReply({ content: `No players with ${label} ratings yet.` });
      return;
    }

    // Pre-fetch members so the @mentions resolve client-side.
    if (interaction.guild) {
      await interaction.guild.members
        .fetch({ user: rows.map((r) => r.discordId) })
        .catch(() => {});
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, i) => {
      const prefix = i < 3 ? medals[i] : `\`${i + 1}.\``;
      return `${prefix} <@${r.discordId}> — **${r.elo}** ${platformEmoji(r.platform)}`;
    });

    await interaction.editReply({
      embeds: [{
        title: `${emoji} ${label} Leaderboard`,
        description: lines.join('\n'),
        color: 0xf59e0b,
        timestamp: new Date().toISOString(),
        footer: {
          text: `Highest ${label.toLowerCase()} across linked accounts • Chessr.io`,
          icon_url: 'https://chessr.io/chessr-logo.png',
        },
      }],
    });
  },
};
