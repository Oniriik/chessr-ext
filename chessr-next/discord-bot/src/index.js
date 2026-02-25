import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { createClient } from '@supabase/supabase-js';

// Configuration
const config = {
  discordToken: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  channelId: process.env.DISCORD_CHANNEL_ID,
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

    // Find or use specific channels for each stat
    const statsToUpdate = [
      {
        pattern: /active.*users/i,
        name: `👥 Active Users: ${serverStats?.realtime?.connectedUsers || 0}`,
      },
      {
        pattern: /suggestions/i,
        name: `📊 Suggestions: ${formatNumber(totalSuggestions)}`,
      },
      {
        pattern: /status/i,
        name: `${status.emoji} Status: ${status.text}`,
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
      const voiceChannels = channels.filter(
        c => c.parentId === config.channelId && c.type === ChannelType.GuildVoice
      );

      for (const stat of statsToUpdate) {
        const channel = voiceChannels.find(c => stat.pattern.test(c.name));
        if (channel) {
          await channel.setName(stat.name);
          console.log(`[Discord] Updated: ${stat.name}`);
        }
      }
    }

    console.log(`[Stats] Updated at ${new Date().toISOString()}`);
    console.log(`  - Active Users: ${serverStats?.realtime?.connectedUsers || 0}`);
    console.log(`  - Total Suggestions: ${totalSuggestions}`);
    console.log(`  - Status: ${status.text}`);
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

  // Schedule periodic updates
  setInterval(updateStatsChannels, config.updateInterval);
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
