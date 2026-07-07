/**
 * Bot entrypoint — boots Discord client, registers slash commands,
 * subscribes to the events bus.
 *
 * Process model: long-running. Restarts via docker compose
 * `restart: unless-stopped`. Graceful shutdown on SIGTERM closes the
 * Discord gateway + Redis sub before exit so docker doesn't have to
 * kill -9 us.
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { log } from './lib/logger.js';
import { redis, redisSub } from './lib/redis.js';
import { startEventBus } from './lib/events.js';
import {
  attachInteractionHandler,
  deployCommands,
  registerCommand,
} from './lib/commands.js';
import { loadPlatformEmojis } from './lib/platformEmoji.js';
import { startStatsChannels } from './handlers/statsChannels.js';
import { registerBoostReward } from './handlers/boostReward.js';
import { registerGiveawayAnnouncer } from './handlers/giveawayAnnouncer.js';
import { registerInviteTracker } from './handlers/inviteTracker.js';
import { registerEventForwarder } from './handlers/eventForwarder.js';
import { registerGuildRoleSync } from './handlers/guildRoleSync.js';
import { registerEloRoleEvents } from './handlers/eloRoleEvents.js';
import { registerWheelTokenDrop } from './handlers/wheelTokenDrop.js';
import { registerDmTracker } from './handlers/dmTracker.js';

// ─── Command registry — explicit imports, no glob ───────────────────────
import { command as rankCommand }        from './commands/rank.js';
import { command as leaderboardCommand } from './commands/leaderboard.js';
import { command as lookupCommand }      from './commands/lookup.js';
import {
  command as inventoryCommand,
  registerInventoryHandlers,
} from './commands/inventory.js';
import { command as giveawayCommand }            from './commands/giveaway.js';
import { command as giveawayLeaderboardCommand } from './commands/giveawayLeaderboard.js';
import { command as tokenCommand }               from './commands/token.js';
import { command as clearCommand }               from './commands/clear.js';
import { ticketCommands, registerTicketHandlers } from './handlers/tickets.js';
import { unverifiedSetupCommand, registerWelcomeUnverified } from './handlers/welcomeUnverified.js';
registerCommand(rankCommand);
registerCommand(leaderboardCommand);
registerCommand(lookupCommand);
registerCommand(inventoryCommand);
registerCommand(giveawayCommand);
registerCommand(giveawayLeaderboardCommand);
registerCommand(tokenCommand);
registerCommand(clearCommand);
for (const cmd of ticketCommands) registerCommand(cmd);
registerCommand(unverifiedSetupCommand);

// ─── Event handlers ─────────────────────────────────────────────────────
import { registerPlanSyncHandlers } from './handlers/planSync.js';
registerPlanSyncHandlers();

// ─── Discord client ─────────────────────────────────────────────────────
// Intents are minimal until features need more. Adding more later only
// requires:
//   1. Bumping the array here
//   2. Toggling the matching switches in the Discord developer portal
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // GuildMembers + DirectMessages + MessageContent are all toggled via
    // the "Privileged Gateway Intents" section of the Discord dev portal
    // — having them in the array isn't enough on its own.
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    // Required for the invite cache + diffing in inviteTracker. Doesn't
    // need a portal toggle (non-privileged), but the bot role still needs
    // "Manage Server" or per-channel "Create Invites" to read invites.
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
});

attachInteractionHandler(client);

client.once('clientReady', async () => {
  log.info(`[discord] logged in as ${client.user?.tag}`);
  // Deploy commands AFTER login so we're sure DISCORD_CLIENT_ID matches
  // the bot we just authed as. A mismatched ID silently 404s.
  try { await deployCommands(); }
  catch (err) { log.error('[commands] deploy failed:', err); }
  // Cache the custom platform emojis (:chesscom:, :lichess:,
  // :worldchess:) from the guild so commands can format them without
  // hardcoded IDs.
  try { await loadPlatformEmojis(client); }
  catch (err) { log.error('[emoji] load failed:', err); }
  // Stats voice channels — silently no-ops when no DISCORD_STATS_*
  // channel IDs are configured.
  startStatsChannels(client);
  registerBoostReward(client);
  registerInventoryHandlers(client);
  registerGiveawayAnnouncer(client);
  registerTicketHandlers(client);
  registerEventForwarder(client);
  registerGuildRoleSync(client);
  registerEloRoleEvents();
  registerWheelTokenDrop(client);
  registerDmTracker(client);
  registerWelcomeUnverified(client);
});

registerInviteTracker(client);

client.on('error', (err) => log.error('[discord] client error:', err));

// ─── Boot ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await startEventBus();
  await client.login(config.discord.token);
}

main().catch((err) => {
  log.error('[boot] fatal:', err);
  process.exit(1);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  log.info(`[shutdown] received ${signal}`);
  try { await client.destroy(); } catch {}
  try { redisSub.disconnect(); } catch {}
  try { redis.disconnect(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT',  () => { shutdown('SIGINT'); });
