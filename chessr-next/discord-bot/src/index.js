import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

// Configuration
const config = {
  discordToken: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  channelId: process.env.DISCORD_CHANNEL_ID,
  signupChannelId: '1476547865039077416',
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

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
  if (!LINK_CHANNEL_ID || (removedIds.length === 0 && addedIds.length === 0)) return;

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

    const channel = await client.channels.fetch(LINK_CHANNEL_ID).catch(() => null);
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

  // 2. ELO roles (mutually exclusive, based on highest rapid)
  const ratings = await getHighestRatings(userSettings.user_id);
  const highestRapid = ratings.rapid;
  const allEloRoleIds = ELO_BRACKETS.map(b => b.roleId).filter(Boolean);
  const targetEloBracket = highestRapid > 0
    ? ELO_BRACKETS.find(b => highestRapid <= b.maxElo)
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

    if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
      console.log(
        `[Roles] ${member.user.tag}: +${rolesToAdd.length} -${rolesToRemove.length}` +
        (targetEloBracket ? ` (ELO: ${highestRapid} → ${targetEloBracket.name})` : ''),
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

// Fetch total suggestions count from Supabase
async function fetchTotalSuggestions() {
  try {
    const { data, error } = await supabase
      .from('global_stats')
      .select('value')
      .eq('key', 'total_suggestions')
      .single();

    if (error) {
      // Fallback: count from user_activity
      const { count } = await supabase
        .from('user_activity')
        .select('*', { count: 'exact', head: true })
        .eq('event_type', 'suggestion');

      return count || 0;
    }

    return data?.value || 0;
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
const tldCountryMap = {
  fr: '🇫🇷 France', de: '🇩🇪 Germany', uk: '🇬🇧 UK', es: '🇪🇸 Spain',
  it: '🇮🇹 Italy', nl: '🇳🇱 Netherlands', be: '🇧🇪 Belgium', ch: '🇨🇭 Switzerland',
  pt: '🇵🇹 Portugal', pl: '🇵🇱 Poland', ru: '🇷🇺 Russia', br: '🇧🇷 Brazil',
  jp: '🇯🇵 Japan', kr: '🇰🇷 South Korea', cn: '🇨🇳 China', in: '🇮🇳 India',
  au: '🇦🇺 Australia', ca: '🇨🇦 Canada', mx: '🇲🇽 Mexico', ar: '🇦🇷 Argentina',
  se: '🇸🇪 Sweden', no: '🇳🇴 Norway', dk: '🇩🇰 Denmark', fi: '🇫🇮 Finland',
  at: '🇦🇹 Austria', cz: '🇨🇿 Czech Republic', ro: '🇷🇴 Romania', hu: '🇭🇺 Hungary',
  gr: '🇬🇷 Greece', tr: '🇹🇷 Turkey', za: '🇿🇦 South Africa', ie: '🇮🇪 Ireland',
  nz: '🇳🇿 New Zealand', co: '🇨🇴 Colombia', cl: '🇨🇱 Chile', pe: '🇵🇪 Peru',
};

function getCountryFromEmail(email) {
  const tld = email.split('@')[1]?.split('.').pop()?.toLowerCase();
  return tld && tldCountryMap[tld] ? tldCountryMap[tld] : '🌍 Unknown';
}

// Check for new signups and notify
const LAST_CHECK_KEY = 'last_signup_check';

async function checkNewSignups() {
  try {
    // Get last check timestamp
    const { data: lastCheckData } = await supabase
      .from('global_stats')
      .select('value')
      .eq('key', LAST_CHECK_KEY)
      .single();

    const lastCheck = lastCheckData?.value
      ? new Date(Number(lastCheckData.value)).toISOString()
      : new Date(Date.now() - 120_000).toISOString(); // 2min ago on first run

    // Find new users
    const newUsers = [];
    let page = 1;
    while (true) {
      const { data: batch } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (!batch?.users.length) break;
      for (const user of batch.users) {
        if (user.created_at > lastCheck && user.email) {
          newUsers.push({ id: user.id, email: user.email, created_at: user.created_at });
        }
      }
      if (batch.users.length < 1000) break;
      page++;
    }

    // Update last check time
    await supabase
      .from('global_stats')
      .upsert({ key: LAST_CHECK_KEY, value: Date.now().toString() }, { onConflict: 'key' });

    if (newUsers.length === 0) return;

    // Fetch stored countries and IPs from signup_ips
    const userIds = newUsers.map(u => u.id);
    const { data: ipData } = await supabase
      .from('signup_ips')
      .select('user_id, country, country_code, ip_address')
      .in('user_id', userIds);

    const countryMap = new Map();
    const ipMap = new Map();
    if (ipData) {
      for (const row of ipData) {
        if (row.country) {
          countryMap.set(row.user_id, row.country);
        }
        if (row.ip_address) {
          ipMap.set(row.user_id, row.ip_address);
        }
      }
    }

    // Get signup channel
    const channel = await client.channels.fetch(config.signupChannelId).catch(() => null);
    if (!channel) {
      console.error('[Signup] Channel not found:', config.signupChannelId);
      return;
    }

    // Send embeds
    newUsers.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const user of newUsers) {
      // Use stored country from IP, fallback to email TLD
      const storedCountry = countryMap.get(user.id);
      const countryText = storedCountry || getCountryFromEmail(user.email);
      const storedIp = ipMap.get(user.id);

      const fields = [
        { name: '📧 Email', value: user.email, inline: true },
        { name: '🌍 Country', value: countryText, inline: true },
      ];

      if (storedIp) {
        fields.push({ name: '🔒 IP', value: storedIp, inline: true });
      }

      await channel.send({
        embeds: [{
          title: '🎉 New User Signup',
          color: 0x10b981,
          fields,
          timestamp: user.created_at,
          footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
        }],
      });
      console.log(`[Signup] Notified: ${user.email} (${countryText}, IP: ${storedIp || 'unknown'})`);
    }

    console.log(`[Signup] ${newUsers.length} new signup(s) notified`);
  } catch (error) {
    console.error('[Signup] Error:', error);
  }
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

    // Get channels by ID from environment or find by name pattern
    const channels = await guild.channels.fetch();

    const connectedUsers = serverStats?.realtime?.connectedUsers || 0;

    // Find or use specific channels for each stat
    const statsToUpdate = [
      {
        pattern: /status/i,
        name: `${status.emoji} Status: ${status.text}`,
      },
      {
        pattern: /total.*users|users.*total/i,
        name: `👥 Total Users: ${formatNumber(premiumStats?.total || 0)}`,
      },
      {
        pattern: /playing|online/i,
        name: `👁 Playing Now: ${connectedUsers}`,
      },
      {
        pattern: /analyzed|suggestions/i,
        name: `🧠 Moves Analyzed: ${formatNumber(totalSuggestions)}`,
      },
      {
        pattern: /premium/i,
        name: `⭐ Premium: ${premiumStats?.totalPremium || 0}`,
      },
    ];

    // Update channel in the stats category
    const statsChannel = channels.get(config.channelId);
    if (statsChannel && statsChannel.type === ChannelType.GuildCategory) {
      // It's a category, update voice channels inside
      let voiceChannels = channels.filter(
        c => c.parentId === config.channelId && c.type === ChannelType.GuildVoice
      );

      for (const stat of statsToUpdate) {
        const channel = voiceChannels.find(c => stat.pattern.test(c.name));
        if (channel) {
          if (channel.name !== stat.name) {
            await channel.setName(stat.name);
            console.log(`[Discord] Updated: ${stat.name}`);
          }
        } else {
          // Create missing voice channel
          await guild.channels.create({
            name: stat.name,
            type: ChannelType.GuildVoice,
            parent: config.channelId,
            permissionOverwrites: [
              {
                id: guild.id,
                deny: ['Connect'],
              },
            ],
          });
          console.log(`[Discord] Created: ${stat.name}`);
        }
      }
    }

    console.log(`[Stats] Updated at ${new Date().toISOString()}`);
    console.log(`  - Status: ${status.text}`);
    console.log(`  - Total Users: ${premiumStats?.total || 0}`);
    console.log(`  - Playing Now: ${connectedUsers}`);
    console.log(`  - Moves Analyzed: ${totalSuggestions}`);
    console.log(`  - Premium: ${premiumStats?.totalPremium || 0}`);

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

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'rank') {
      await handleRankCommand(interaction);
    } else if (interaction.commandName === 'leaderboard') {
      await handleLeaderboardCommand(interaction);
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
// Bot Events
// =============================================================================

// When a new member joins, check if they have a linked Chessr account
client.on('guildMemberAdd', async (member) => {
  try {
    const { data: userSettings } = await supabase
      .from('user_settings')
      .select('user_id, plan, discord_id')
      .eq('discord_id', member.id)
      .single();

    if (!userSettings) return; // No linked account

    // Mark user as in guild
    await supabase
      .from('user_settings')
      .update({ discord_in_guild: true })
      .eq('user_id', userSettings.user_id);

    await assignRoles(member, userSettings);
    console.log(`[Roles] Assigned roles to new member ${member.user.tag} (Chessr linked)`);
  } catch (error) {
    console.error(`[Roles] Error on member join ${member.user.tag}:`, error.message);
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
});

// Bot ready event
client.once('ready', async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}`);
  console.log(`[Discord] Watching guild: ${config.guildId}`);
  console.log(`[Discord] Update interval: ${config.updateInterval / 1000}s`);

  // Register slash commands
  await registerCommands();

  // Initial update
  await updateStatsChannels();
  await checkNewSignups();
  await syncAllRoles();

  // Schedule periodic updates
  setInterval(updateStatsChannels, config.updateInterval);
  setInterval(checkNewSignups, 120_000); // Check signups every 2 minutes
  setInterval(syncAllRoles, 10 * 60 * 1000); // Sync roles every 10 minutes
});

// Error handling
client.on('error', (error) => {
  console.error('[Discord] Client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[Process] Unhandled rejection:', error);
});

// Start bot
console.log('[Bot] Starting Chessr Stats Bot...');
client.login(config.discordToken);
