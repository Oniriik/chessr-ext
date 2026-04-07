import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, SlashCommandBuilder, REST, Routes, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Partials } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

// Configuration
const config = {
  discordToken: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  channelId: process.env.DISCORD_CHANNEL_ID,
  discordChannelId: process.env.DISCORD_CHANNEL_DISCORD,
  chessrServerUrl: process.env.CHESSR_SERVER_URL || 'https://engine.chessr.io',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  updateInterval: parseInt(process.env.UPDATE_INTERVAL || '60') * 1000,
};

// Role configuration
const PLAN_ROLES = {
  free: process.env.DISCORD_ROLE_FREE,
  freetrial: process.env.DISCORD_ROLE_FREETRIAL,
  premium: process.env.DISCORD_ROLE_PREMIUM,
  lifetime: process.env.DISCORD_ROLE_LIFETIME,
  beta: process.env.DISCORD_ROLE_BETA,
};

const ELO_BRACKETS = [
  { name: 'Beginner',     maxElo: 799,      roleId: process.env.DISCORD_ROLE_ELO_0 },
  { name: 'Novice',       maxElo: 999,      roleId: process.env.DISCORD_ROLE_ELO_800 },
  { name: 'Intermediate', maxElo: 1199,     roleId: process.env.DISCORD_ROLE_ELO_1000 },
  { name: 'Club Player',  maxElo: 1399,     roleId: process.env.DISCORD_ROLE_ELO_1200 },
  { name: 'Advanced',     maxElo: 1599,     roleId: process.env.DISCORD_ROLE_ELO_1400 },
  { name: 'Expert',       maxElo: 1799,     roleId: process.env.DISCORD_ROLE_ELO_1600 },
  { name: 'Master',       maxElo: 1999,     roleId: process.env.DISCORD_ROLE_ELO_1800 },
  { name: 'Grandmaster',  maxElo: Infinity, roleId: process.env.DISCORD_ROLE_ELO_2000 },
];

const LINK_CHANNEL_ID = process.env.DISCORD_LINK_CHANNEL_ID;

// =============================================================================
// Ticket System Configuration
// =============================================================================

const CHESSR_TEAM_ROLE_ID = '1464229158782763081';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://dashboard.chessr.io';

const TICKET_TYPES = {
  support: {
    label: 'Support',
    prefix: 'help',
    closedPrefix: 'closed',
    categoryId: '1464217313879396427',
    closedCategoryId: '1464219123805323380',
    panelChannelId: '1464217383739723914',
    logChannelId: null,
    teamRoleId: CHESSR_TEAM_ROLE_ID,
    panelEmbed: {
      title: '🎫 Chessr Support',
      description: 'Need help with your account, a bug, or billing?\nOpen a ticket and our team will assist you.',
      color: 0x3b82f6,
    },
    welcomeMessage: (user, ticketNumber) =>
      `🎫 **Ticket #${ticketNumber}** opened by ${user}\n\nPlease describe your issue and <@&${CHESSR_TEAM_ROLE_ID}> will get back to you shortly.`,
  },
  abuse: {
    label: 'Abuse',
    prefix: 'abuse',
    closedPrefix: 'closed',
    categoryId: '1490137015415738428',
    closedCategoryId: '1490137254033752335',
    panelChannelId: null,
    logChannelId: null,
    teamRoleId: CHESSR_TEAM_ROLE_ID,
    panelEmbed: null,
    welcomeMessage: (user, _ticketNumber, extra) => {
      const types = extra?.types || 'Account Review';
      return `⚠️ **Abuse Investigation** — ${user}\n\nYour account has been flagged for review.\n\n📋 **Reason:** ${types}\n📧 If you believe this is an error, please explain below.\n\n<@&${CHESSR_TEAM_ROLE_ID}> will review your case shortly.`;
    },
  },
};

// Initialize Supabase
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// Format large numbers (1000 -> 1K, 1000000 -> 1M)
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Initialize Discord client with GuildMembers intent for role management
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Invite tracking cache: Map<inviteCode, uses>
const inviteCache = new Map();

// =============================================================================
// DM Job Management (in-memory)
// =============================================================================
const dmJobs = new Map();
// Track which job last DMed each user: discordId → jobId
const lastJobPerUser = new Map();

// Cleanup jobs older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of dmJobs) {
    if (job.createdAt < cutoff) dmJobs.delete(id);
  }
}, 5 * 60 * 1000);

// =============================================================================
// Role Management
// =============================================================================

/**
 * Get the highest ELO for each time control across all linked accounts
 */
async function getHighestRatings(userId) {
  const { data: accounts } = await supabase
    .from('linked_accounts')
    .select('rating_bullet, rating_blitz, rating_rapid')
    .eq('user_id', userId)
    .is('unlinked_at', null);

  if (!accounts || accounts.length === 0) return { bullet: 0, blitz: 0, rapid: 0 };
  return {
    bullet: Math.max(0, ...accounts.map(a => a.rating_bullet || 0)),
    blitz: Math.max(0, ...accounts.map(a => a.rating_blitz || 0)),
    rapid: Math.max(0, ...accounts.map(a => a.rating_rapid || 0)),
  };
}

// Reverse lookup: roleId → name
function getRoleName(roleId) {
  for (const [plan, id] of Object.entries(PLAN_ROLES)) {
    if (id === roleId) return plan;
  }
  for (const b of ELO_BRACKETS) {
    if (b.roleId === roleId) return b.name;
  }
  return roleId;
}

/**
 * Send role change notification to Discord channel
 */
async function notifyRoleChange(member, removedIds, addedIds) {
  const roleChannelId = config.discordChannelId || LINK_CHANNEL_ID;
  if (!roleChannelId || (removedIds.length === 0 && addedIds.length === 0)) return;

  try {
    const fields = [
      { name: '🎮 Discord', value: member.user.tag, inline: true },
    ];

    if (removedIds.length > 0) {
      fields.push({
        name: '❌ Removed',
        value: removedIds.map(id => getRoleName(id)).join(', '),
        inline: true,
      });
    }
    if (addedIds.length > 0) {
      fields.push({
        name: '✅ Added',
        value: addedIds.map(id => getRoleName(id)).join(', '),
        inline: true,
      });
    }

    const channel = await client.channels.fetch(roleChannelId).catch(() => null);
    if (!channel) return;

    await channel.send({
      embeds: [{
        title: '🔄 Role Update',
        color: 0xffa500,
        fields,
        thumbnail: { url: member.user.displayAvatarURL({ size: 64 }) },
        timestamp: new Date().toISOString(),
        footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
      }],
    });
  } catch (err) {
    console.error('[Roles] Failed to send notification:', err.message);
  }
}

/**
 * Assign plan + ELO roles to a Discord guild member
 */
async function assignRoles(member, userSettings) {
  const rolesToAdd = [];
  const rolesToRemove = [];

  // 1. Plan roles (mutually exclusive)
  const allPlanRoleIds = Object.values(PLAN_ROLES).filter(Boolean);
  const targetPlanRoleId = PLAN_ROLES[userSettings.plan];

  for (const roleId of allPlanRoleIds) {
    if (roleId === targetPlanRoleId) {
      if (!member.roles.cache.has(roleId)) rolesToAdd.push(roleId);
    } else {
      if (member.roles.cache.has(roleId)) rolesToRemove.push(roleId);
    }
  }

  // 2. ELO roles (mutually exclusive, based on highest rating across all time controls)
  const ratings = await getHighestRatings(userSettings.user_id);
  const highestElo = Math.max(ratings.bullet, ratings.blitz, ratings.rapid);
  const allEloRoleIds = ELO_BRACKETS.map(b => b.roleId).filter(Boolean);
  const targetEloBracket = highestElo > 0
    ? ELO_BRACKETS.find(b => highestElo <= b.maxElo)
    : null;
  const targetEloRoleId = targetEloBracket?.roleId;

  for (const roleId of allEloRoleIds) {
    if (roleId === targetEloRoleId) {
      if (!member.roles.cache.has(roleId)) rolesToAdd.push(roleId);
    } else {
      if (member.roles.cache.has(roleId)) rolesToRemove.push(roleId);
    }
  }

  // Apply changes
  try {
    if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
    if (rolesToAdd.length > 0) await member.roles.add(rolesToAdd);

    // Update sync timestamp
    await supabase
      .from('user_settings')
      .update({ discord_roles_synced_at: new Date().toISOString() })
      .eq('discord_id', member.id);

    if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
      console.log(
        `[Roles] ${member.user.tag}: +${rolesToAdd.length} -${rolesToRemove.length}` +
        (targetEloBracket ? ` (ELO: ${highestElo} → ${targetEloBracket.name})` : ''),
      );

      // Send notification
      await notifyRoleChange(member, rolesToRemove, rolesToAdd);
    }
  } catch (error) {
    console.error(`[Roles] Failed for ${member.user.tag}:`, error.message);
  }
}

/**
 * Sync roles for all linked Discord users (periodic)
 */
async function syncAllRoles() {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  const { data: linkedUsers } = await supabase
    .from('user_settings')
    .select('user_id, plan, discord_id')
    .not('discord_id', 'is', null);

  if (!linkedUsers || linkedUsers.length === 0) return;

  let synced = 0;
  for (const user of linkedUsers) {
    try {
      const member = await guild.members.fetch(user.discord_id).catch(() => null);
      const inGuild = !!member;

      // Update discord_in_guild in database
      await supabase
        .from('user_settings')
        .update({ discord_in_guild: inGuild })
        .eq('user_id', user.user_id);

      if (!member) continue;

      await assignRoles(member, user);
      synced++;

      // Rate limit: 250ms between users
      await new Promise(r => setTimeout(r, 250));
    } catch (error) {
      console.error(`[Roles] Sync failed for ${user.discord_id}:`, error.message);
    }
  }

  if (synced > 0) {
    console.log(`[Roles] Synced ${synced}/${linkedUsers.length} users`);
  }
}

// =============================================================================
// Stats & Signup Functions (unchanged)
// =============================================================================

// Fetch stats from Chessr server
async function fetchServerStats() {
  try {
    const response = await fetch(`${config.chessrServerUrl}/stats`);
    if (!response.ok) throw new Error('Server not responding');
    return await response.json();
  } catch (error) {
    console.error('[Stats] Failed to fetch server stats:', error.message);
    return null;
  }
}

// Fetch premium user counts from Supabase
async function fetchPremiumStats() {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('plan');

    if (error) throw error;

    const counts = {
      beta: 0,
      premium: 0,
      lifetime: 0,
      freetrial: 0,
      total: data.length,
    };

    data.forEach(user => {
      if (user.plan === 'beta') counts.beta++;
      else if (user.plan === 'premium') counts.premium++;
      else if (user.plan === 'lifetime') counts.lifetime++;
      else if (user.plan === 'freetrial') counts.freetrial++;
    });

    counts.totalPremium = counts.beta + counts.premium + counts.lifetime;

    return counts;
  } catch (error) {
    console.error('[Stats] Failed to fetch premium stats:', error.message);
    return null;
  }
}

// Fetch total suggestions count from Supabase (komodo + maia)
async function fetchTotalSuggestions() {
  try {
    const { data, error } = await supabase
      .from('global_stats')
      .select('key, value')
      .in('key', ['total_suggestions', 'total_maia_suggestions']);

    if (error || !data?.length) {
      return 0;
    }

    return data.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  } catch (error) {
    console.error('[Stats] Failed to fetch suggestions count:', error.message);
    return 0;
  }
}

// Determine server status
function getServerStatus(stats) {
  if (!stats) return { emoji: '🔴', text: 'Stopped' };

  const { pools } = stats;
  const komodoAvailable = pools.komodo?.available || 0;
  const stockfishAvailable = pools.stockfish?.available || 0;

  if (komodoAvailable === 0 && stockfishAvailable === 0) {
    return { emoji: '🟡', text: 'Maintenance' };
  }

  return { emoji: '🟢', text: 'Working' };
}

// Country detection from email TLD
// Signup notifications are now sent by the server via /report-signup endpoint

// Stats channel IDs cache (loaded from global_stats on startup)
const STATS_CHANNELS_KEY = 'stats_channel_ids';
let statsChannelIds = null; // { status: id, users: id, playing: id, analyzed: id, premium: id }

async function loadStatsChannelIds() {
  const { data } = await supabase
    .from('global_stats')
    .select('value')
    .eq('key', STATS_CHANNELS_KEY)
    .single();
  if (data?.value) {
    try {
      statsChannelIds = JSON.parse(data.value);
    } catch { statsChannelIds = null; }
  }
}

async function saveStatsChannelIds(ids) {
  statsChannelIds = ids;
  await supabase
    .from('global_stats')
    .upsert({ key: STATS_CHANNELS_KEY, value: JSON.stringify(ids), updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

// Update channel names with stats
async function updateStatsChannels() {
  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      console.error('[Discord] Guild not found');
      return;
    }

    const [serverStats, premiumStats, totalSuggestions] = await Promise.all([
      fetchServerStats(),
      fetchPremiumStats(),
      fetchTotalSuggestions(),
    ]);
    const status = getServerStatus(serverStats);

    const connectedUsers = serverStats?.realtime?.connectedUsers || 0;

    const statsToUpdate = [
      { key: 'status', pattern: /status/i, name: `${status.emoji} Status: ${status.text}` },
      { key: 'users', pattern: /total.*users|users.*total/i, name: `👥 Total Users: ${formatNumber(premiumStats?.total || 0)}` },
      { key: 'playing', pattern: /playing|online/i, name: `👁 Playing Now: ${connectedUsers}` },
      { key: 'analyzed', pattern: /analyzed|suggestions/i, name: `🧠 Moves Analyzed: ${formatNumber(totalSuggestions)}` },
      { key: 'premium', pattern: /premium/i, name: `⭐ Premium: ${premiumStats?.totalPremium || 0}` },
    ];

    // Load stored channel IDs if not cached yet
    if (!statsChannelIds) await loadStatsChannelIds();

    const updatedIds = { ...(statsChannelIds || {}) };

    for (const stat of statsToUpdate) {
      let channel = null;

      // Try to fetch by stored ID first
      const storedId = updatedIds[stat.key];
      if (storedId) {
        channel = await guild.channels.fetch(storedId).catch(() => null);
      }

      // Fallback: find by name pattern in the stats category
      if (!channel) {
        const channels = await guild.channels.fetch();
        channel = channels.find(
          c => c.parentId === config.channelId && c.type === ChannelType.GuildVoice && stat.pattern.test(c.name)
        );
      }

      if (channel) {
        updatedIds[stat.key] = channel.id;
        if (channel.name !== stat.name) {
          await channel.setName(stat.name);
        }
      } else {
        // Create missing voice channel
        const created = await guild.channels.create({
          name: stat.name,
          type: ChannelType.GuildVoice,
          parent: config.channelId,
          permissionOverwrites: [{ id: guild.id, deny: ['Connect'] }],
        });
        updatedIds[stat.key] = created.id;
        console.log(`[Discord] Created: ${stat.name}`);
      }
    }

    // Persist channel IDs so we don't recreate on next boot
    await saveStatsChannelIds(updatedIds);

    console.log(`[Stats] Updated at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('[Discord] Update failed:', error);
  }
}

// =============================================================================
// Slash Commands
// =============================================================================

const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show the Chessr rank of a member')
    .addUserOption(opt => opt.setName('member').setDescription('The member to check').setRequired(false)),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 players by ELO')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('Time control (default: rapid)')
        .setRequired(false)
        .addChoices(
          { name: 'Rapid', value: 'rapid' },
          { name: 'Blitz', value: 'blitz' },
          { name: 'Bullet', value: 'bullet' },
        )),
  new SlashCommandBuilder()
    .setName('lookup')
    .setDescription('Look up a user\'s Chessr account details (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('member').setDescription('The Discord user to look up').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Send the ticket panel embed in the current channel (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Ticket type')
        .setRequired(true)
        .addChoices(...Object.keys(TICKET_TYPES).filter(k => TICKET_TYPES[k].panelEmbed).map(k => ({ name: TICKET_TYPES[k].label, value: k })))),
  new SlashCommandBuilder()
    .setName('ticket-new')
    .setDescription('Create a support ticket for a user (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('member').setDescription('The user to create a ticket for').setRequired(true)),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Show current giveaway info and your invite count'),
  new SlashCommandBuilder()
    .setName('giveaway-leaderboard')
    .setDescription('Show the top inviters for the current giveaway'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, config.guildId),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log('[Commands] Slash commands registered');
  } catch (err) {
    console.error('[Commands] Failed to register:', err.message);
  }
}

function getEloColor(elo) {
  if (elo >= 2000) return 0xf59e0b; // gold
  if (elo >= 1800) return 0xa855f7; // purple
  if (elo >= 1600) return 0x3b82f6; // blue
  if (elo >= 1400) return 0x10b981; // green
  if (elo >= 1200) return 0x6366f1; // indigo
  if (elo >= 1000) return 0x8b5cf6; // violet
  if (elo >= 800) return 0x64748b;  // slate
  return 0x94a3b8; // gray
}

async function handleRankCommand(interaction) {
  await interaction.deferReply();
  const targetUser = interaction.options.getUser('member') || interaction.user;

  // Look up in Supabase
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, discord_username')
    .eq('discord_id', targetUser.id)
    .single();

  if (!settings) {
    await interaction.editReply({
      content: `${targetUser} hasn't linked their Chessr account yet.`,
    });
    return;
  }

  const ratings = await getHighestRatings(settings.user_id);

  const fields = [
    { name: '⚡ Bullet', value: ratings.bullet > 0 ? `**${ratings.bullet}**` : 'N/A', inline: true },
    { name: '🔥 Blitz', value: ratings.blitz > 0 ? `**${ratings.blitz}**` : 'N/A', inline: true },
    { name: '🕐 Rapid', value: ratings.rapid > 0 ? `**${ratings.rapid}**` : 'N/A', inline: true },
  ];

  await interaction.editReply({
    embeds: [{
      title: `${targetUser.username}'s Profile`,
      color: getEloColor(ratings.rapid),
      fields,
      thumbnail: { url: targetUser.displayAvatarURL({ size: 128 }) },
      timestamp: new Date().toISOString(),
      footer: { text: 'Ratings updated every 30 min • Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
    }],
  });
}

const MODE_CONFIG = {
  rapid:  { emoji: '🕐', label: 'Rapid',  column: 'rating_rapid' },
  blitz:  { emoji: '🔥', label: 'Blitz',  column: 'rating_blitz' },
  bullet: { emoji: '⚡', label: 'Bullet', column: 'rating_bullet' },
};

async function handleLeaderboardCommand(interaction) {
  await interaction.deferReply();
  const mode = interaction.options.getString('mode') || 'rapid';
  const { emoji, label, column } = MODE_CONFIG[mode];

  // Get all linked users with discord_id
  const { data: linkedUsers } = await supabase
    .from('user_settings')
    .select('user_id, discord_id, discord_username')
    .not('discord_id', 'is', null);

  if (!linkedUsers || linkedUsers.length === 0) {
    await interaction.editReply({ content: 'No linked players yet.' });
    return;
  }

  // Get all linked accounts ratings
  const userIds = linkedUsers.map(u => u.user_id);
  const { data: allAccounts } = await supabase
    .from('linked_accounts')
    .select(`user_id, ${column}`)
    .in('user_id', userIds)
    .is('unlinked_at', null);

  // Calculate max rating per user
  const eloMap = new Map();
  if (allAccounts) {
    for (const a of allAccounts) {
      const current = eloMap.get(a.user_id) || 0;
      if ((a[column] || 0) > current) {
        eloMap.set(a.user_id, a[column]);
      }
    }
  }

  // Build leaderboard
  const leaderboard = linkedUsers
    .map(u => ({
      discordId: u.discord_id,
      username: u.discord_username || 'Unknown',
      elo: eloMap.get(u.user_id) || 0,
    }))
    .filter(u => u.elo > 0)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 10);

  if (leaderboard.length === 0) {
    await interaction.editReply({ content: `No players with ${label} ratings yet.` });
    return;
  }

  // Pre-fetch guild members so Discord resolves mentions on all clients
  const guild = interaction.guild;
  if (guild) {
    const ids = leaderboard.map(u => u.discordId).filter(Boolean);
    await guild.members.fetch({ user: ids }).catch(() => {});
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = leaderboard.map((u, i) => {
    const prefix = i < 3 ? medals[i] : `\`${i + 1}.\``;
    return `${prefix} <@${u.discordId}> — **${u.elo}**`;
  });

  await interaction.editReply({
    embeds: [{
      title: `${emoji} ${label} Leaderboard`,
      description: lines.join('\n'),
      color: 0xf59e0b,
      timestamp: new Date().toISOString(),
      footer: { text: `Highest ${label.toLowerCase()} across linked accounts • Updated every 30 min • Chessr.io`, icon_url: 'https://chessr.io/chessr-logo.png' },
    }],
  });
}

async function handleLookupCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const targetUser = interaction.options.getUser('member');
  const LOOKUP_CHANNEL_ID = '1464202530362888258';

  // Find Chessr account by discord_id
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, plan_expiry, banned, ban_reason, signup_country, signup_country_code, discord_linked_at, freetrial_used')
    .eq('discord_id', targetUser.id)
    .single();

  if (!settings) {
    await interaction.editReply({ content: `${targetUser} has no linked Chessr account.` });
    return;
  }

  // Get email from auth
  const { data: authData } = await supabase.auth.admin.getUserById(settings.user_id);
  const email = authData?.user?.email || 'unknown';
  const createdAt = authData?.user?.created_at;

  // Get subscription details from Paddle
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan, interval, status, canceled_at, current_period_end')
    .eq('user_id', settings.user_id)
    .single();

  // Build plan info
  let planText = settings.plan;
  if (sub) {
    const interval = sub.interval === 'year' ? 'yearly' : sub.interval === 'month' ? 'monthly' : sub.interval || '';
    const statusEmoji = sub.status === 'active' ? '🟢' : sub.status === 'canceled' ? '🔴' : '🟡';
    planText = `**${settings.plan}** (${interval})\n${statusEmoji} ${sub.status}`;
    if (sub.canceled_at) {
      planText += `\n❌ Cancelled: <t:${Math.floor(new Date(sub.canceled_at).getTime() / 1000)}:R>`;
    }
    if (sub.current_period_end) {
      const label = sub.canceled_at ? 'Expires' : 'Renews';
      planText += `\n📅 ${label}: <t:${Math.floor(new Date(sub.current_period_end).getTime() / 1000)}:R>`;
    }
  } else if (settings.plan === 'lifetime') {
    planText = '**lifetime** ♾️';
  } else if (settings.plan === 'free') {
    planText = `**free**${settings.freetrial_used ? ' (trial used)' : ''}`;
  }
  if (settings.plan_expiry && settings.plan !== 'lifetime') {
    const ts = Math.floor(new Date(settings.plan_expiry).getTime() / 1000);
    planText += `\n⏰ Expiry: <t:${ts}:R>`;
  }

  // Get IPs with countries
  const { data: ips } = await supabase
    .from('signup_ips')
    .select('ip_address, country, country_code, created_at')
    .eq('user_id', settings.user_id)
    .order('created_at', { ascending: true });

  let ipText = 'None';
  if (ips?.length) {
    ipText = ips.map(ip => `\`${ip.ip_address}\` — ${ip.country || 'Unknown'}`).join('\n');
    if (ipText.length > 1024) {
      ipText = ips.slice(0, 10).map(ip => `\`${ip.ip_address}\` — ${ip.country || 'Unknown'}`).join('\n') + `\n... +${ips.length - 10} more`;
    }
  }

  // Get linked chess accounts
  const { data: linkedAccounts } = await supabase
    .from('linked_accounts')
    .select('platform, platform_username, display_name, rating_rapid, rating_blitz, rating_bullet')
    .eq('user_id', settings.user_id)
    .is('unlinked_at', null);

  // Get fingerprints
  const { data: fingerprints } = await supabase
    .from('user_fingerprints')
    .select('fingerprint, created_at')
    .eq('user_id', settings.user_id)
    .order('created_at', { ascending: true });

  let fingerprintText = 'None';
  if (fingerprints?.length) {
    fingerprintText = fingerprints.map(fp => `\`${fp.fingerprint}\``).join('\n');
    if (fingerprintText.length > 1024) {
      fingerprintText = fingerprints.slice(0, 5).map(fp => `\`${fp.fingerprint}\``).join('\n') + `\n... +${fingerprints.length - 5} more`;
    }
  }

  let accountsText = 'None';
  if (linkedAccounts?.length) {
    accountsText = linkedAccounts.map(a => {
      const ratings = [
        a.rating_rapid > 0 ? `R:${a.rating_rapid}` : null,
        a.rating_blitz > 0 ? `B:${a.rating_blitz}` : null,
        a.rating_bullet > 0 ? `⚡:${a.rating_bullet}` : null,
      ].filter(Boolean).join(' ');
      const platformName = a.platform === 'chesscom' ? 'Chess.com' : a.platform === 'lichess' ? 'Lichess' : a.platform === 'worldchess' ? 'World Chess' : a.platform;
      const displayName = a.display_name || a.platform_username;
      return `**${platformName}** ${displayName}${ratings ? ` (${ratings})` : ''}`;
    }).join('\n');
  }

  const fields = [
    { name: '📧 Email', value: email, inline: true },
    { name: '💎 Plan', value: planText, inline: true },
    { name: '🌍 Country', value: settings.signup_country || 'Unknown', inline: true },
    { name: '♟️ Linked Accounts', value: accountsText, inline: false },
    { name: '🔑 IPs', value: ipText, inline: false },
    { name: '🖥️ Fingerprints', value: fingerprintText, inline: false },
  ];

  if (settings.banned) {
    fields.unshift({ name: '🚫 BANNED', value: settings.ban_reason || 'No reason', inline: false });
  }

  if (createdAt) {
    const ts = Math.floor(new Date(createdAt).getTime() / 1000);
    fields.push({ name: '📅 Registered', value: `<t:${ts}:f> (<t:${ts}:R>)`, inline: true });
  }

  const embed = {
    title: `🔍 Lookup: ${targetUser.username}`,
    color: settings.banned ? 0xef4444 : 0x3b82f6,
    fields,
    thumbnail: { url: targetUser.displayAvatarURL({ size: 128 }) },
    timestamp: new Date().toISOString(),
    footer: { text: `User ID: ${settings.user_id} • Requested by ${interaction.user.username}`, icon_url: 'https://chessr.io/chessr-logo.png' },
  };

  // Send to admin channel so all admins can see
  const adminChannel = await client.channels.fetch(LOOKUP_CHANNEL_ID).catch(() => null);
  if (adminChannel) {
    await adminChannel.send({ embeds: [embed] });
    await interaction.editReply({ content: `✅ Lookup sent to <#${LOOKUP_CHANNEL_ID}>` });
  } else {
    await interaction.editReply({ embeds: [embed] });
  }
}

// =============================================================================
// Ticket System Handlers
// =============================================================================

async function handleTicketSetup(interaction) {
  const type = interaction.options.getString('type');
  const ticketType = TICKET_TYPES[type];
  if (!ticketType) {
    await interaction.reply({ content: `Unknown ticket type: ${type}`, ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(ticketType.panelEmbed.title)
    .setDescription(ticketType.panelEmbed.description)
    .setColor(ticketType.panelEmbed.color)
    .setFooter({ text: 'Chessr.io', iconURL: 'https://chessr.io/chessr-logo.png' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_open:${type}`)
      .setLabel('Open a Ticket')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🆕'),
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: '✅ Ticket panel sent.', ephemeral: true });
}

async function handleTicketNew(interaction) {
  const targetUser = interaction.options.getUser('member');
  const ticketType = TICKET_TYPES.support;
  const guild = interaction.guild;

  await interaction.deferReply({ ephemeral: true });

  // Check if user already has an open support ticket
  const existing = guild.channels.cache.find(
    ch => ch.parentId === ticketType.categoryId &&
          ch.name.startsWith(`${ticketType.prefix}-`) &&
          ch.topic?.includes(targetUser.id)
  );
  if (existing) {
    await interaction.editReply({ content: `This user already has an open ticket: ${existing}` });
    return;
  }

  const ticketNumber = await getNextTicketNumber('support');
  const paddedNumber = String(ticketNumber).padStart(4, '0');
  const channelName = `${ticketType.prefix}-${paddedNumber}-${targetUser.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: ticketType.categoryId,
    topic: `Ticket #${paddedNumber} | Opened by ${targetUser.tag} (${targetUser.id}) | Created by ${interaction.user.tag}`,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: targetUser.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: ticketType.teamRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  const buttons = [
    new ButtonBuilder().setCustomId('ticket_close:support').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId('ticket_info:support').setLabel('Info').setStyle(ButtonStyle.Primary).setEmoji('ℹ️'),
  ];
  const closeRow = new ActionRowBuilder().addComponents(...buttons);

  await channel.send({
    content: `🎫 **Ticket #${paddedNumber}** opened by <@&${CHESSR_TEAM_ROLE_ID}> for <@${targetUser.id}>\n\nPlease describe your issue and we will get back to you shortly.`,
    components: [closeRow],
  });

  await interaction.editReply({ content: `✅ Ticket created for ${targetUser}: ${channel}` });
  console.log(`[Tickets] ${interaction.user.tag} created ticket for ${targetUser.tag}: ${channelName}`);
}

async function getNextTicketNumber(type) {
  const { data, error } = await supabase.rpc('increment_ticket_counter', { ticket_type: type });
  if (error || data === null) {
    // Fallback: manual increment
    const { data: counter } = await supabase
      .from('ticket_counters')
      .select('last_number')
      .eq('type', type)
      .single();
    const next = (counter?.last_number || 0) + 1;
    await supabase.from('ticket_counters').update({ last_number: next }).eq('type', type);
    return next;
  }
  return data;
}

async function handleTicketOpen(interaction) {
  const type = interaction.customId.split(':')[1];
  const ticketType = TICKET_TYPES[type];
  if (!ticketType) return;

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const user = interaction.user;

  // Check if user already has an open ticket of this type
  const existing = guild.channels.cache.find(
    ch => ch.parentId === ticketType.categoryId &&
          ch.name.startsWith(`${ticketType.prefix}-`) &&
          ch.topic?.includes(user.id)
  );
  if (existing) {
    await interaction.editReply({ content: `You already have an open ticket: ${existing}` });
    return;
  }

  // Get next ticket number
  const ticketNumber = await getNextTicketNumber(type);
  const paddedNumber = String(ticketNumber).padStart(4, '0');
  const channelName = `${ticketType.prefix}-${paddedNumber}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  // Create channel
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: ticketType.categoryId,
    topic: `Ticket #${paddedNumber} | Opened by ${user.tag} (${user.id})`,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: ticketType.teamRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  // Send welcome message with close + info buttons
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`ticket_close:${type}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
    new ButtonBuilder()
      .setCustomId(`ticket_info:${type}`)
      .setLabel('Info')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('ℹ️'),
  ];
  const closeRow = new ActionRowBuilder().addComponents(...buttons);

  await channel.send({
    content: ticketType.welcomeMessage(`<@${user.id}>`, paddedNumber),
    components: [closeRow],
  });

  await interaction.editReply({ content: `✅ Ticket created: ${channel}` });
  console.log(`[Tickets] ${user.tag} opened ${channelName}`);
}

async function handleTicketClose(interaction) {
  const type = interaction.customId.split(':')[1];
  const ticketType = TICKET_TYPES[type];
  if (!ticketType) {
    console.error(`[Tickets] Unknown ticket type: ${type}`);
    return;
  }

  const channel = interaction.channel;
  console.log(`[Tickets] Close requested in ${channel.name} (parent: ${channel.parentId}, expected: ${ticketType.categoryId})`);

  // Allow close if channel is in the open OR closed category (in case of re-close)
  const validParents = [ticketType.categoryId, ticketType.closedCategoryId].filter(Boolean);
  if (!validParents.includes(channel.parentId)) {
    await interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
    return;
  }

  // Show confirmation
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_confirm_close:${type}`)
      .setLabel('Confirm Close')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ticket_cancel_close')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const confirmEmbed = new EmbedBuilder()
    .setDescription('⚠️ Are you sure you want to close this ticket?')
    .setColor(0xffa500);

  await interaction.reply({
    embeds: [confirmEmbed],
    components: [confirmRow],
    ephemeral: true,
  });
}

async function handleTicketConfirmClose(interaction) {
  const type = interaction.customId.split(':')[1];
  const ticketType = TICKET_TYPES[type];
  if (!ticketType) {
    console.error(`[Tickets] Confirm close: unknown type ${type}`);
    return;
  }

  console.log(`[Tickets] Confirm close in ${interaction.channel.name}`);

  try {
    await interaction.deferUpdate();
  } catch (e) {
    console.error('[Tickets] deferUpdate failed:', e.message);
    // Interaction may have already been acknowledged — continue anyway
  }

  const channel = interaction.channel;
  const closedBy = interaction.user;

  // Extract ticket number from channel name
  const match = channel.name.match(new RegExp(`^${ticketType.prefix}-(\\d+)-`));
  const ticketNumber = match ? match[1] : '0000';

  console.log(`[Tickets] Processing close for ${channel.name}, ticket #${ticketNumber}`);

  // Collect messages for transcript
  let sorted = [];
  let transcript = '';
  try {
    console.log('[Tickets] Fetching messages...');
    const messages = await channel.messages.fetch({ limit: 100 });
    sorted = [...messages.values()].reverse();
    transcript = sorted
      .filter(m => !m.author.bot || m.content)
      .map(m => `${m.author.tag}: ${m.content || '(embed/attachment)'}`)
      .join('\n');
    console.log(`[Tickets] Fetched ${sorted.length} messages`);
  } catch (e) {
    console.error('[Tickets] Fetch messages failed:', e.message);
  }

  // Extract opener from topic
  const openerMatch = channel.topic?.match(/\((\d+)\)/);
  const openerId = openerMatch ? openerMatch[1] : null;

  // Send log to closed tickets channel
  if (ticketType.logChannelId) {
    try {
      const logChannel = await interaction.guild.channels.fetch(ticketType.logChannelId).catch(() => null);
      if (logChannel?.isTextBased()) {
        const logEmbed = new EmbedBuilder()
          .setTitle(`🔒 Ticket #${ticketNumber} Closed`)
          .setColor(0x94a3b8)
          .addFields(
            { name: '👤 Opened by', value: openerId ? `<@${openerId}>` : 'Unknown', inline: true },
            { name: '🔒 Closed by', value: `<@${closedBy.id}>`, inline: true },
            { name: '💬 Messages', value: String(sorted.length), inline: true },
          )
          .setTimestamp()
          .setFooter({ text: 'Chessr.io', iconURL: 'https://chessr.io/chessr-logo.png' });

        const files = [];
        if (transcript.length > 0) {
          files.push({ attachment: Buffer.from(transcript, 'utf-8'), name: `transcript-${ticketNumber}.txt` });
        }

        await logChannel.send({ embeds: [logEmbed], files });
      }
    } catch (e) {
      console.error('[Tickets] Log send failed:', e.message);
    }
  }

  // Rename and move to closed category
  console.log('[Tickets] Renaming channel...');
  const currentName = channel.name;
  const closedName = currentName.startsWith(`${ticketType.closedPrefix}-`)
    ? currentName
    : currentName.replace(new RegExp(`^${ticketType.prefix}-`), `${ticketType.closedPrefix}-`);
  try {
    if (closedName !== currentName) await channel.setName(closedName);
    console.log(`[Tickets] Renamed to ${closedName}`);
  } catch (e) {
    console.error('[Tickets] Rename to closed failed (rate-limit?):', e.message);
  }
  console.log('[Tickets] Moving to closed category...');
  if (ticketType.closedCategoryId) {
    await channel.setParent(ticketType.closedCategoryId, { lockPermissions: false }).catch(e => console.error('[Tickets] Move to closed category failed:', e.message));
  }
  console.log('[Tickets] Moved. Removing opener access...');

  // Remove the opener's access
  if (openerId) {
    await channel.permissionOverwrites.edit(openerId, { ViewChannel: false }).catch(() => {});
  }

  console.log('[Tickets] Sending close message...');
  // Send closed message with reopen button
  const reopenRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_reopen:${type}`)
      .setLabel('Reopen Ticket')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔓'),
  );

  const closedEmbed = new EmbedBuilder()
    .setDescription(`🔒 Ticket closed by <@${closedBy.id}>`)
    .setColor(0x94a3b8)
    .setTimestamp();

  await channel.send({
    embeds: [closedEmbed],
    components: [reopenRow],
  });

  console.log(`[Tickets] ${closedBy.tag} closed ticket #${ticketNumber}`);
}

async function handleTicketReopen(interaction) {
  const type = interaction.customId.split(':')[1];
  const ticketType = TICKET_TYPES[type];
  if (!ticketType) return;

  const channel = interaction.channel;

  // Check it's actually a closed ticket (by category, not name — rename may have been rate-limited)
  const validClosedParents = [ticketType.closedCategoryId, ticketType.categoryId].filter(Boolean);
  if (!validClosedParents.includes(channel.parentId)) {
    await interaction.reply({ content: 'This ticket is not closed.', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  // Rename and move back to open category
  const currentName = channel.name;
  const openName = currentName.startsWith(`${ticketType.closedPrefix}-`)
    ? currentName.replace(new RegExp(`^${ticketType.closedPrefix}-`), `${ticketType.prefix}-`)
    : currentName;
  try {
    if (openName !== currentName) await channel.setName(openName);
  } catch (e) {
    console.error('[Tickets] Rename to open failed (rate-limit?):', e.message);
  }
  await channel.setParent(ticketType.categoryId, { lockPermissions: false }).catch(() => {});

  // Restore opener's access
  const openerMatch = channel.topic?.match(/\((\d+)\)/);
  const openerId = openerMatch ? openerMatch[1] : null;
  if (openerId) {
    await channel.permissionOverwrites.edit(openerId, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    }).catch(() => {});
  }

  // Send reopen message with close + info buttons
  const buttons = [
    new ButtonBuilder().setCustomId(`ticket_close:${type}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId(`ticket_info:${type}`).setLabel('Info').setStyle(ButtonStyle.Primary).setEmoji('ℹ️'),
  ];
  const row = new ActionRowBuilder().addComponents(...buttons);

  const reopenEmbed = new EmbedBuilder()
    .setDescription(`🔓 Ticket reopened by <@${interaction.user.id}>`)
    .setColor(0x10b981)
    .setTimestamp();

  await channel.send({
    embeds: [reopenEmbed],
    components: [row],
  });

  console.log(`[Tickets] ${interaction.user.tag} reopened ticket in ${channel.name}`);
}

async function handleTicketInfo(interaction) {
  const type = interaction.customId.split(':')[1];
  const ticketType = TICKET_TYPES[type];
  if (!ticketType) return;

  await interaction.deferReply({ flags: 64 });

  // Check if user has the team role (admin only)
  const member = interaction.member;
  if (!member.roles.cache.has(ticketType.teamRoleId)) {
    await interaction.editReply({ content: '❌ You don\'t have permission to view this.' });
    return;
  }

  const channel = interaction.channel;

  // Extract opener from topic
  const openerMatch = channel.topic?.match(/\((\d+)\)/);
  const openerId = openerMatch ? openerMatch[1] : null;

  if (!openerId) {
    await interaction.editReply({ content: 'Could not find ticket owner info.' });
    return;
  }

  // Look up the user in Supabase
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, freetrial_used, discord_id, discord_username, banned, ban_reason')
    .eq('discord_id', openerId)
    .single();

  if (!settings) {
    await interaction.editReply({ content: `No Chessr account found for <@${openerId}>.` });
    return;
  }

  // Get email
  const { data: authData } = await supabase.auth.admin.getUserById(settings.user_id);
  const email = authData?.user?.email || 'unknown';

  // Get linked chess accounts
  const { data: linkedAccounts } = await supabase
    .from('linked_accounts')
    .select('platform, platform_username, rating_bullet, rating_blitz, rating_rapid')
    .eq('user_id', settings.user_id)
    .is('unlinked_at', null);

  // Get fingerprints
  const { data: fingerprints } = await supabase
    .from('user_fingerprints')
    .select('fingerprint')
    .eq('user_id', settings.user_id);

  // Get IPs
  const { data: ips } = await supabase
    .from('signup_ips')
    .select('ip_address, country')
    .eq('user_id', settings.user_id);

  // Check abuse cases
  const { data: abuseCases } = await supabase
    .from('abuse_cases')
    .select('id, types, status, reasons, user_ids')
    .contains('user_ids', [settings.user_id]);

  // Build fields
  const fields = [
    { name: '📧 Email', value: email, inline: true },
    { name: '💎 Plan', value: `${settings.plan}${settings.freetrial_used ? ' (trial used)' : ''}`, inline: true },
    { name: '🎮 Discord', value: `<@${openerId}>`, inline: true },
  ];

  if (settings.banned) {
    fields.push({ name: '🚫 Banned', value: settings.ban_reason || 'No reason', inline: false });
  }

  if (linkedAccounts?.length) {
    const accountsText = linkedAccounts.map(a => {
      const platform = a.platform === 'chesscom' ? 'Chess.com' : a.platform === 'lichess' ? 'Lichess' : a.platform;
      const ratings = [a.rating_bullet && `🎯${a.rating_bullet}`, a.rating_blitz && `⚡${a.rating_blitz}`, a.rating_rapid && `⏱️${a.rating_rapid}`].filter(Boolean).join(' ');
      return `**${platform}** ${a.platform_username}${ratings ? ` (${ratings})` : ''}`;
    }).join('\n');
    fields.push({ name: '♟️ Linked Accounts', value: accountsText, inline: false });
  }

  if (fingerprints?.length) {
    const fpText = fingerprints.map(f => `\`${f.fingerprint}\``).join(', ');
    for (let i = 0; i < fpText.length; i += 1024) {
      fields.push({ name: i === 0 ? '🖥️ Fingerprints' : '🖥️ Fingerprints (cont.)', value: fpText.slice(i, i + 1024), inline: false });
    }
  }

  if (ips?.length) {
    const ipLines = ips.map(i => `\`${i.ip_address}\` ${i.country || ''}`);
    let chunk = '';
    let part = 0;
    for (const line of ipLines) {
      if ((chunk + line + '\n').length > 1024) {
        fields.push({ name: part === 0 ? `🔒 IPs (${ips.length})` : '🔒 IPs (cont.)', value: chunk, inline: false });
        chunk = '';
        part++;
      }
      chunk += line + '\n';
    }
    if (chunk) fields.push({ name: part === 0 ? `🔒 IPs (${ips.length})` : '🔒 IPs (cont.)', value: chunk, inline: false });
  }

  if (abuseCases?.length) {
    const casesText = abuseCases.map(c => {
      const types = (c.types || []).map(t => t === 'multi_account' ? 'Multi-Account' : 'VPN').join(', ');
      return `${c.status === 'open' ? '🔴' : '🟢'} ${types} — ${c.user_ids.length} accounts`;
    }).join('\n');
    fields.push({ name: '🚨 Abuse Cases', value: casesText, inline: false });

    // Add dashboard link for abuse cases
    const filterEmails = [email];
    const filterParam = encodeURIComponent(filterEmails.join(','));
    fields.push({ name: '🔗 Dashboard', value: `[View abuse cases](${DASHBOARD_URL}/?tab=abuse&filter=${filterParam})`, inline: false });
  }

  // Split fields into multiple embeds if needed (max 25 fields / 6000 chars per embed)
  const embeds = [];
  let currentFields = [];
  let currentLen = 0;
  for (const field of fields) {
    const fieldLen = field.name.length + field.value.length;
    if (currentFields.length >= 25 || (currentLen + fieldLen > 5500 && currentFields.length > 0)) {
      embeds.push(currentFields);
      currentFields = [];
      currentLen = 0;
    }
    currentFields.push(field);
    currentLen += fieldLen;
  }
  if (currentFields.length) embeds.push(currentFields);

  const embedObjects = embeds.map((chunk, i) => {
    const e = new EmbedBuilder().setColor(0x3b82f6).addFields(chunk);
    if (i === 0) e.setTitle(`ℹ️ Ticket Info — ${email}`);
    if (i === embeds.length - 1) e.setTimestamp().setFooter({ text: 'Chessr.io — Staff Only', iconURL: 'https://chessr.io/chessr-logo.png' });
    return e;
  });

  await interaction.editReply({ embeds: embedObjects });
}

// =============================================================================
// Interaction Handler (commands + buttons)
// =============================================================================

client.on('interactionCreate', async (interaction) => {
  // Button interactions
  if (interaction.isButton()) {
    try {
      const id = interaction.customId;
      if (id.startsWith('ticket_open:')) return await handleTicketOpen(interaction);
      if (id.startsWith('ticket_close:')) return await handleTicketClose(interaction);
      if (id.startsWith('ticket_confirm_close:')) return await handleTicketConfirmClose(interaction);
      if (id.startsWith('ticket_info:')) return await handleTicketInfo(interaction);
      if (id.startsWith('ticket_reopen:')) return await handleTicketReopen(interaction);
      if (id === 'ticket_cancel_close') {
        await interaction.update({ content: '❌ Close cancelled.', components: [] });
        return;
      }
    } catch (err) {
      console.error('[Tickets] Button error:', err.message, err.stack, err);
      const reply = { content: 'Something went wrong.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
    return;
  }

  // Slash command interactions
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'rank') {
      await handleRankCommand(interaction);
    } else if (interaction.commandName === 'leaderboard') {
      await handleLeaderboardCommand(interaction);
    } else if (interaction.commandName === 'lookup') {
      await handleLookupCommand(interaction);
    } else if (interaction.commandName === 'ticket-setup') {
      await handleTicketSetup(interaction);
    } else if (interaction.commandName === 'ticket-new') {
      await handleTicketNew(interaction);
    } else if (interaction.commandName === 'giveaway') {
      await handleGiveaway(interaction);
    } else if (interaction.commandName === 'giveaway-leaderboard') {
      await handleGiveawayLeaderboard(interaction);
    }
  } catch (err) {
    console.error(`[Commands] Error in /${interaction.commandName}:`, err.message);
    const reply = { content: 'Something went wrong.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// =============================================================================
// Giveaway Commands
// =============================================================================

async function handleGiveaway(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Get active giveaway period
  const { data: period } = await supabase
    .from('giveaway_periods')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!period) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle('🎁 Giveaway')
        .setDescription('No active giveaway at the moment. Stay tuned!')
        .setFooter({ text: 'Chessr.io', iconURL: 'https://chessr.io/chessr-logo.png' })],
    });
  }

  // Get invite count for this user during the period
  const { data: userInvites, error } = await supabase
    .from('invite_events')
    .select('id', { count: 'exact' })
    .eq('inviter_discord_id', interaction.user.id)
    .eq('still_in_guild', true)
    .gte('created_at', period.starts_at)
    .lte('created_at', period.ends_at);

  const inviteCount = error ? 0 : (userInvites?.length || 0);

  // Get total participants (guild members)
  const guild = interaction.guild;
  const totalMembers = guild?.memberCount || '?';

  // Get total invites in period
  const { data: allInvites } = await supabase
    .from('invite_events')
    .select('id', { count: 'exact' })
    .eq('still_in_guild', true)
    .gte('created_at', period.starts_at)
    .lte('created_at', period.ends_at);

  const totalInvites = allInvites?.length || 0;

  const endsAt = Math.floor(new Date(period.ends_at).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`🎁 ${period.name}`)
    .setDescription([
      `**Ends:** <t:${endsAt}:R> (<t:${endsAt}:F>)`,
      '',
      `👥 **${totalMembers}** members · 📨 **${totalInvites}** invites this period`,
      '',
      '**How it works:**',
      '• Every server member gets 1 ticket',
      '• Each invite = 1 bonus ticket',
      '• More invites = more chances to win!',
    ].join('\n'))
    .addFields(
      { name: '📨 Your Invites', value: `**${inviteCount}**`, inline: true },
      { name: '🎟️ Your Tickets', value: `**${1 + inviteCount}**`, inline: true },
    )
    .setFooter({ text: 'Chessr.io Giveaway', iconURL: 'https://chessr.io/chessr-logo.png' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleGiveawayLeaderboard(interaction) {
  await interaction.deferReply();

  // Get active giveaway period
  const { data: period } = await supabase
    .from('giveaway_periods')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!period) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle('🎁 Giveaway Leaderboard')
        .setDescription('No active giveaway at the moment.')],
    });
  }

  // Get all invites in period grouped by inviter
  const { data: invites } = await supabase
    .from('invite_events')
    .select('inviter_discord_id, inviter_username')
    .eq('still_in_guild', true)
    .gte('created_at', period.starts_at)
    .lte('created_at', period.ends_at);

  if (!invites || invites.length === 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle(`🏆 ${period.name} — Leaderboard`)
        .setDescription('No invites yet for this period. Be the first!')],
    });
  }

  // Count per inviter
  const counts = {};
  for (const inv of invites) {
    const key = inv.inviter_discord_id;
    if (!counts[key]) counts[key] = { username: inv.inviter_username, count: 0 };
    counts[key].count++;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);

  const medals = ['🥇', '🥈', '🥉'];
  const lines = sorted.map(([discordId, data], i) => {
    const prefix = medals[i] || `**${i + 1}.**`;
    return `${prefix} <@${discordId}> — **${data.count}** invite${data.count > 1 ? 's' : ''} (${1 + data.count} tickets)`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`🏆 ${period.name} — Leaderboard`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${invites.length} total invites this period`, iconURL: 'https://chessr.io/chessr-logo.png' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// =============================================================================
// Bot Events
// =============================================================================

// When a new member joins, check if they have a linked Chessr account
client.on('guildMemberAdd', async (member) => {
  // Send welcome DM (plain text — embeds don't render before onboarding)
  try {
    await member.send([
      `# Welcome to chessr.io! ♟️`,
      '',
      `Hey **${member.user.username}**! You've just unlocked the best chess cheat 😈`,
      '',
      '📜 [Rules](https://discord.com/channels/1464202133653028945/1464223587346157754) · ♟️ [What is chessr.io](https://discord.com/channels/1464202133653028945/1464223587346157754) · 📢 [Announcements](https://discord.com/channels/1464202133653028945/1464202530362888255) · 💻 [Install](https://discord.com/channels/1464202133653028945/1464226843996459018)',
      '',
      '🔓 **Free Chess.com Game Reviews** — Unlock full game reviews without any Chess.com subscription. [See how →](https://discord.com/channels/1464202133653028945/1464232479442473104/1490412414590779443)',
      '',
      '🎟️ **Free Trial** — Link your Discord in **Settings** to unlock premium for 3 days. No credit card.',
      '',
      '🔥 **Code DISCORD50** — 50% off monthly, yearly & lifetime. Only 3 claims left → [Pricing](https://chessr.io/#pricing)',
    ].join('\n'));
    console.log(`[Welcome] Sent DM to ${member.user.tag}`);
  } catch (dmError) {
    console.log(`[Welcome] Could not DM ${member.user.tag} (DMs probably closed)`);
  }

  // Assign roles if account is linked
  try {
    const { data: userSettings } = await supabase
      .from('user_settings')
      .select('user_id, plan, discord_id')
      .eq('discord_id', member.id)
      .single();

    if (userSettings) {
      // Mark user as in guild
      await supabase
        .from('user_settings')
        .update({ discord_in_guild: true })
        .eq('user_id', userSettings.user_id);

      await assignRoles(member, userSettings);
      console.log(`[Roles] Assigned roles to new member ${member.user.tag} (Chessr linked)`);
    }
  } catch (error) {
    console.error(`[Roles] Error on member join ${member.user.tag}:`, error.message);
  }

  // Track invite used
  try {
    const guild = member.guild;
    const newInvites = await guild.invites.fetch();
    const usedInvite = newInvites.find(inv => {
      const oldUses = inviteCache.get(inv.code) || 0;
      return inv.uses > oldUses;
    });

    // Update cache
    newInvites.forEach(inv => inviteCache.set(inv.code, inv.uses));

    if (usedInvite && usedInvite.inviter) {
      // Check if this person was already invited (leave/rejoin)
      const { data: existing } = await supabase
        .from('invite_events')
        .select('id')
        .eq('invited_discord_id', member.id)
        .limit(1);

      if (existing && existing.length > 0) {
        // Just mark them as back in guild
        await supabase
          .from('invite_events')
          .update({ still_in_guild: true })
          .eq('invited_discord_id', member.id);
        console.log(`[Invites] ${member.user.username} rejoined — updated still_in_guild (no new ticket)`);
      } else {
        await supabase.from('invite_events').insert({
          inviter_discord_id: usedInvite.inviter.id,
          inviter_username: usedInvite.inviter.username,
          invited_discord_id: member.id,
          invited_username: member.user.username,
          invite_code: usedInvite.code,
          still_in_guild: true,
        });
        console.log(`[Invites] ${usedInvite.inviter.username} invited ${member.user.username} (code: ${usedInvite.code})`);

        // DM the inviter about their new ticket
        try {
          const inviter = await client.users.fetch(usedInvite.inviter.id);
          // Count total invites for this user
          const { data: allInvites } = await supabase
            .from('invite_events')
            .select('id')
            .eq('inviter_discord_id', usedInvite.inviter.id)
            .eq('still_in_guild', true);
          const totalInvites = allInvites?.length || 1;

          await inviter.send({
            embeds: [new EmbedBuilder()
              .setColor(0x6366f1)
              .setTitle('🎟️ +1 Giveaway Ticket!')
              .setDescription([
                `**${member.user.username}** joined using your invite!`,
                '',
                `You now have **${totalInvites}** invite${totalInvites > 1 ? 's' : ''} → **${1 + totalInvites} tickets** for the giveaway 🎁`,
                '',
                'Keep inviting to increase your chances!',
              ].join('\n'))
              .setFooter({ text: 'Chessr.io Giveaway', iconURL: 'https://chessr.io/chessr-logo.png' })
              .setTimestamp()],
          });
        } catch (dmErr) {
          console.log(`[Invites] Could not DM inviter ${usedInvite.inviter.username} (DMs closed)`);
        }
      }
    } else {
      console.log(`[Invites] Could not determine inviter for ${member.user.username}`);
    }
  } catch (err) {
    console.error(`[Invites] Tracking error for ${member.user.tag}:`, err.message);
  }
});

// When a member leaves, update discord_in_guild
client.on('guildMemberRemove', async (member) => {
  try {
    const { data: userSettings } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('discord_id', member.id)
      .single();

    if (!userSettings) return;

    await supabase
      .from('user_settings')
      .update({ discord_in_guild: false })
      .eq('user_id', userSettings.user_id);

    console.log(`[Guild] Member left: ${member.user.tag} → discord_in_guild = false`);
  } catch (error) {
    console.error(`[Guild] Error on member leave ${member.user.tag}:`, error.message);
  }

  // Mark invite as no longer in guild
  try {
    await supabase
      .from('invite_events')
      .update({ still_in_guild: false })
      .eq('invited_discord_id', member.id);
  } catch (err) {
    console.error(`[Invites] Failed to update leave for ${member.user.tag}:`, err.message);
  }
});

// Keep invite cache in sync
client.on('inviteCreate', (invite) => {
  inviteCache.set(invite.code, invite.uses);
});
client.on('inviteDelete', (invite) => {
  inviteCache.delete(invite.code);
});

// Track DM responses
client.on('messageCreate', async (message) => {
  // Only track DMs from real users (not from guilds, not from bots)
  if (message.guild || message.author.bot) return;

  try {
    // Find the job that last DMed this specific user
    const matchedJobId = lastJobPerUser.get(message.author.id) || null;

    // Build content: text + attachments + stickers
    const parts = [];
    if (message.content) parts.push(message.content);
    if (message.attachments.size > 0) {
      for (const [, att] of message.attachments) {
        parts.push(att.contentType?.startsWith('image/') ? `[image: ${att.url}]` : `[file: ${att.name} — ${att.url}]`);
      }
    }
    if (message.stickers.size > 0) {
      for (const [, sticker] of message.stickers) {
        parts.push(`[sticker: ${sticker.name}]`);
      }
    }
    const fullContent = parts.join('\n') || '[empty message]';

    await supabase.from('dm_responses').insert({
      discord_id: message.author.id,
      discord_username: message.author.username,
      content: fullContent,
      job_id: matchedJobId,
    });

    console.log(`[DM Response] ${message.author.username}: ${fullContent.substring(0, 80)}`);
  } catch (err) {
    console.error('[DM Response] Error saving:', err.message);
  }
});

// Bot ready event
client.once('ready', async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}`);
  console.log(`[Discord] Watching guild: ${config.guildId}`);
  console.log(`[Discord] Update interval: ${config.updateInterval / 1000}s`);

  // Register slash commands
  await registerCommands();

  // Cache guild invites for tracking
  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (guild) {
      const invites = await guild.invites.fetch();
      invites.forEach(inv => inviteCache.set(inv.code, inv.uses));
      console.log(`[Invites] Cached ${inviteCache.size} invites`);
    }
  } catch (err) {
    console.error('[Invites] Failed to cache invites:', err.message);
  }

  // Initial update
  await updateStatsChannels();
  await syncAllRoles();

  // Schedule periodic updates
  setInterval(updateStatsChannels, config.updateInterval);
  setInterval(syncAllRoles, 10 * 60 * 1000); // Sync roles every 10 minutes

});

// Error handling
client.on('error', (error) => {
  console.error('[Discord] Client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[Process] Unhandled rejection:', error);
});

// ─── Internal HTTP API for role sync triggers ───────────────────────────────
import http from 'http';

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // POST /sync-roles { userId } — trigger immediate role sync for a specific user
  if (req.url === '/sync-roles' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { userId } = JSON.parse(body);
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing userId' }));
          return;
        }

        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Guild not found' }));
          return;
        }

        // Fetch user settings
        const { data: userSettings } = await supabase
          .from('user_settings')
          .select('user_id, plan, discord_id')
          .eq('user_id', userId)
          .single();

        if (!userSettings?.discord_id) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, skipped: 'no discord linked' }));
          return;
        }

        const member = await guild.members.fetch(userSettings.discord_id).catch(() => null);
        if (member) {
          await assignRoles(member, userSettings);
          console.log(`[Roles] Instant sync for ${member.user.tag} → ${userSettings.plan}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[Roles] Sync endpoint error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error' }));
      }
    });
    return;
  }

  // POST /create-abuse-ticket { discordId, abuseTypes, dashboardLink }
  if (req.url === '/create-abuse-ticket' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', async () => {
      try {
        const { discordId, abuseTypes, dashboardLink } = JSON.parse(body);
        if (!discordId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing discordId' }));
          return;
        }

        const ticketType = TICKET_TYPES.abuse;
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Guild not found' }));
          return;
        }

        // Fetch the Discord member
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (!member) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'User not in server' }));
          return;
        }

        // Check if already has an open abuse ticket
        const existing = guild.channels.cache.find(
          ch => ch.parentId === ticketType.categoryId &&
                ch.name.startsWith(`${ticketType.prefix}-`) &&
                ch.topic?.includes(discordId)
        );
        if (existing) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, channelId: existing.id, existing: true }));
          return;
        }

        // Get next ticket number
        const ticketNumber = await getNextTicketNumber('abuse');
        const paddedNumber = String(ticketNumber).padStart(4, '0');
        const channelName = `${ticketType.prefix}-${paddedNumber}-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

        // Create channel
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: ticketType.categoryId,
          topic: `Abuse Ticket #${paddedNumber} | User: ${member.user.tag} (${discordId})`,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: discordId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: ticketType.teamRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ],
        });

        // Build type display
        const typesDisplay = (abuseTypes || []).map(t => t === 'multi_account' ? 'Multi-Account' : t === 'vpn' ? 'VPN Usage' : t).join(', ') || 'Account Review';

        // Send welcome message
        const buttons = [
          new ButtonBuilder().setCustomId('ticket_close:abuse').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
          new ButtonBuilder().setCustomId('ticket_info:abuse').setLabel('Info').setStyle(ButtonStyle.Primary).setEmoji('ℹ️'),
        ];
        const row = new ActionRowBuilder().addComponents(...buttons);

        await channel.send({
          content: ticketType.welcomeMessage(`<@${discordId}>`, paddedNumber, { types: typesDisplay }),
          components: [row],
        });

        console.log(`[Tickets] Abuse ticket created for ${member.user.tag}: ${channelName}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, channelId: channel.id }));
      } catch (err) {
        console.error('[Tickets] Create abuse ticket error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error' }));
      }
    });
    return;
  }

  // ─── GET /member-count ───
  if (req.method === 'GET' && url.pathname === '/member-count') {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ memberCount: guild.memberCount }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ─── POST /send-dm-batch ───
  if (req.method === 'POST' && req.url === '/send-dm-batch') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { jobId, discordIds, content, embed } = JSON.parse(body);
        if (!jobId || !discordIds?.length || (!content && !embed)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing jobId, discordIds, or content/embed' }));
          return;
        }

        // Resolve {{memberCount}}
        let memberCount = '';
        try {
          const guild = await client.guilds.fetch(config.guildId);
          memberCount = guild.memberCount.toString();
        } catch { /* ignore */ }

        const job = {
          total: discordIds.length,
          sent: 0,
          failed: 0,
          failures: [],
          done: false,
          createdAt: Date.now(),
        };
        dmJobs.set(jobId, job);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));

        // Process DMs asynchronously
        for (const discordId of discordIds) {
          try {
            const user = await client.users.fetch(discordId);
            // Replace variables
            const replaceVars = (text) => text
              .replace(/\{\{user\}\}/g, `<@${discordId}>`)
              .replace(/\{\{memberCount\}\}/g, memberCount);

            const sendPayload = {};
            if (content) sendPayload.content = replaceVars(content);
            if (embed) {
              sendPayload.embeds = [{
                title: embed.title ? replaceVars(embed.title) : undefined,
                description: embed.description ? replaceVars(embed.description) : undefined,
                color: embed.color || 0x5865f2,
                footer: { text: 'chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
                timestamp: new Date().toISOString(),
              }];
            }
            await user.send(sendPayload);
            job.sent++;
            lastJobPerUser.set(discordId, jobId);
            // Log sent message
            try {
              const logContent = sendPayload.content || (embed ? `[embed] ${embed.title || ''}: ${embed.description || ''}` : '');
              await supabase.from('dm_sent').insert({
                discord_id: discordId,
                discord_username: user.username,
                content: logContent,
                job_id: jobId,
              });
            } catch { /* ignore logging errors */ }
          } catch (err) {
            job.failed++;
            job.failures.push({
              discordId,
              username: err.user?.username || discordId,
              reason: err.code === 50007 ? 'DMs closed' : err.message,
            });
          }
          // Rate limit: 4 DMs/sec
          await new Promise(r => setTimeout(r, 250));
        }
        job.done = true;
        console.log(`[DM Batch] Job ${jobId} complete: ${job.sent} sent, ${job.failed} failed`);
      } catch (err) {
        console.error('[DM Batch] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error' }));
      }
    });
    return;
  }

  // ─── GET /dm-job-status ───
  if (req.method === 'GET' && url.pathname === '/dm-job-status') {
    const jobId = url.searchParams.get('jobId') || '';
    const job = dmJobs.get(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: job.total,
      sent: job.sent,
      failed: job.failed,
      failures: job.failures,
      done: job.done,
    }));
    return;
  }

  // ─── POST /fetch-message ───
  if (req.method === 'POST' && req.url === '/fetch-message') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { channelId, messageId } = JSON.parse(body);
        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          content: message.content,
          author: { username: message.author.username, avatar: message.author.displayAvatarURL() },
          embeds: message.embeds.map(e => e.toJSON()),
        }));
      } catch (err) {
        console.error('[Fetch Message] Error:', err.message);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message not found' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(3100, () => {
  console.log('[Bot] Internal API listening on port 3100');
});

// Start bot
console.log('[Bot] Starting Chessr Stats Bot...');
client.login(config.discordToken);
