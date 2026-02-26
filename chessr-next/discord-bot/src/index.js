import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
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

// Initialize Supabase
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// Format large numbers (1000 -> 1K, 1000000 -> 1M)
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

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
          newUsers.push({ email: user.email, created_at: user.created_at });
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

    // Get signup channel
    const channel = await client.channels.fetch(config.signupChannelId).catch(() => null);
    if (!channel) {
      console.error('[Signup] Channel not found:', config.signupChannelId);
      return;
    }

    // Send embeds
    newUsers.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (const user of newUsers) {
      await channel.send({
        embeds: [{
          title: '🎉 New User Signup',
          color: 0x10b981,
          fields: [
            { name: '📧 Email', value: user.email, inline: true },
            { name: '🌍 Country', value: getCountryFromEmail(user.email), inline: true },
          ],
          timestamp: user.created_at,
          footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
        }],
      });
      console.log(`[Signup] Notified: ${user.email}`);
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

// Bot ready event
client.once('ready', async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}`);
  console.log(`[Discord] Watching guild: ${config.guildId}`);
  console.log(`[Discord] Update interval: ${config.updateInterval / 1000}s`);

  // Initial update
  await updateStatsChannels();
  await checkNewSignups();

  // Schedule periodic updates
  setInterval(updateStatsChannels, config.updateInterval);
  setInterval(checkNewSignups, 120_000); // Check signups every 2 minutes
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
