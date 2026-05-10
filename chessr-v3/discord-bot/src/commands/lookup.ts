import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  type APIEmbed,
} from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { config } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { platformLabel } from '../lib/ratings.js';
import { platformEmoji } from '../lib/platformEmoji.js';

// /lookup <member> — admin-only deep dump on a Discord member's Chessr
// account: email, plan + paddle subscription state, country, linked
// chess accounts (chess.com / lichess / worldchess) with ratings, IPs
// and fingerprint history. Posts to DISCORD_LOOKUP_CHANNEL_ID when
// configured so all admins can read it; falls back to an ephemeral
// reply otherwise.

function rel(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return `<t:${Math.floor(new Date(ts).getTime() / 1000)}:R>`;
}

function abs(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return `<t:${Math.floor(new Date(ts).getTime() / 1000)}:f>`;
}

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription("Look up a user's Chessr account details (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt.setName('member').setDescription('The Discord user to look up').setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('member', true);

    // 1. Locate the chessr account by discord_id.
    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_id, plan, plan_expiry, banned, ban_reason, freetrial_used, discord_linked_at')
      .eq('discord_id', target.id)
      .maybeSingle();

    if (!settings) {
      await interaction.editReply({ content: `${target} has no linked Chessr account.` });
      return;
    }

    // 2. Email + auth metadata.
    const { data: authData } = await supabase.auth.admin.getUserById(settings.user_id);
    const email = authData?.user?.email ?? 'unknown';
    const createdAt = authData?.user?.created_at ?? null;

    // 3. Paddle subscription state — present for paid users, null for
    //    gifted plans / freetrial / lifetime-via-admin.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan, interval, status, canceled_at, current_period_end')
      .eq('user_id', settings.user_id)
      .maybeSingle();

    let planText = `**${settings.plan}**`;
    if (sub) {
      const interval = sub.interval === 'year'
        ? 'yearly'
        : sub.interval === 'month'
          ? 'monthly'
          : sub.interval ?? '';
      const statusEmoji = sub.status === 'active' ? '🟢' : sub.status === 'canceled' ? '🔴' : '🟡';
      planText = `**${settings.plan}** (${interval})\n${statusEmoji} ${sub.status}`;
      const cancelledAt = rel(sub.canceled_at);
      if (cancelledAt) planText += `\n❌ Cancelled: ${cancelledAt}`;
      if (sub.current_period_end) {
        const label = sub.canceled_at ? 'Expires' : 'Renews';
        planText += `\n📅 ${label}: ${rel(sub.current_period_end)}`;
      }
    } else if (settings.plan === 'lifetime') {
      planText = '**lifetime** ♾️';
    } else if (settings.plan === 'free') {
      planText = `**free**${settings.freetrial_used ? ' (trial used)' : ''}`;
    }
    if (settings.plan_expiry && settings.plan !== 'lifetime') {
      planText += `\n⏰ Expiry: ${rel(settings.plan_expiry)}`;
    }

    // 4. Linked chess accounts — same query as v2 but the platform
    //    label helper now knows about World Chess.
    const { data: linkedAccounts } = await supabase
      .from('linked_accounts')
      .select('platform, platform_username, display_name, rating_rapid, rating_blitz, rating_bullet')
      .eq('user_id', settings.user_id)
      .is('unlinked_at', null);

    const accountsText = (linkedAccounts && linkedAccounts.length > 0)
      ? linkedAccounts.map((a) => {
          const ratings = [
            a.rating_rapid && a.rating_rapid > 0 ? `R:${a.rating_rapid}` : null,
            a.rating_blitz && a.rating_blitz > 0 ? `B:${a.rating_blitz}` : null,
            a.rating_bullet && a.rating_bullet > 0 ? `⚡:${a.rating_bullet}` : null,
          ].filter(Boolean).join(' ');
          const display = a.display_name || a.platform_username;
          return `${platformEmoji(a.platform)} **${platformLabel(a.platform)}** ${display}${ratings ? ` (${ratings})` : ''}`;
        }).join('\n')
      : 'None';

    // 5. IPs with country labels — most-recent country surfaces in the
    //    Country headline field below.
    const { data: ips } = await supabase
      .from('signup_ips')
      .select('ip_address, country, country_code, created_at')
      .eq('user_id', settings.user_id)
      .order('created_at', { ascending: false });

    let ipText = 'None';
    if (ips && ips.length > 0) {
      const lines = ips.map((ip) => `\`${ip.ip_address}\` — ${ip.country || 'Unknown'}`);
      ipText = lines.join('\n');
      // 1024 is the field-value limit. Truncate cleanly with a count
      // so admins know more rows exist.
      if (ipText.length > 1024) {
        const head = lines.slice(0, 10).join('\n');
        ipText = `${head}\n... +${ips.length - 10} more`;
      }
    }
    const country = ips?.[0]?.country ?? 'Unknown';

    // 6. Fingerprint history.
    const { data: fingerprints } = await supabase
      .from('user_fingerprints')
      .select('fingerprint, created_at')
      .eq('user_id', settings.user_id)
      .order('created_at', { ascending: false });

    let fpText = 'None';
    if (fingerprints && fingerprints.length > 0) {
      const lines = fingerprints.map((f) => `\`${f.fingerprint}\``);
      fpText = lines.join('\n');
      if (fpText.length > 1024) {
        const head = lines.slice(0, 5).join('\n');
        fpText = `${head}\n... +${fingerprints.length - 5} more`;
      }
    }

    // 7. Compose the embed.
    const fields: APIEmbed['fields'] = [
      { name: '📧 Email',           value: email,        inline: true },
      { name: '💎 Plan',            value: planText,     inline: true },
      { name: '🌍 Country',         value: country,      inline: true },
      { name: '♟️ Linked Accounts', value: accountsText, inline: false },
      { name: '🔑 IPs',             value: ipText,       inline: false },
      { name: '🖥️ Fingerprints',    value: fpText,       inline: false },
    ];

    if (settings.banned) {
      fields.unshift({
        name: '🚫 BANNED',
        value: settings.ban_reason || 'No reason given',
        inline: false,
      });
    }

    if (createdAt) {
      fields.push({
        name: '📅 Registered',
        value: `${abs(createdAt)} (${rel(createdAt)})`,
        inline: true,
      });
    }

    const embed: APIEmbed = {
      title: `🔍 Lookup: ${target.username}`,
      color: settings.banned ? 0xef4444 : 0x3b82f6,
      fields,
      thumbnail: { url: target.displayAvatarURL({ size: 128 }) },
      timestamp: new Date().toISOString(),
      footer: {
        text: `User ID: ${settings.user_id} • Requested by ${interaction.user.username}`,
        icon_url: 'https://chessr.io/chessr-logo.png',
      },
    };

    // Post to the admin channel when configured so every admin can see;
    // fall back to ephemeral reply when DISCORD_LOOKUP_CHANNEL_ID isn't set
    // or the channel isn't reachable.
    const channelId = config.discord.lookupChannelId;
    if (channelId) {
      try {
        const channel = await interaction.client.channels.fetch(channelId);
        if (channel && channel instanceof TextChannel) {
          await channel.send({ embeds: [embed] });
          await interaction.editReply({ content: `✅ Lookup sent to <#${channelId}>` });
          return;
        }
      } catch { /* fall through to ephemeral */ }
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
