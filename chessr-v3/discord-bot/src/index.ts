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

// ─── Command registry — explicit imports, no glob ───────────────────────
import { command as pingCommand }        from './commands/ping.js';
import { command as rankCommand }        from './commands/rank.js';
import { command as leaderboardCommand } from './commands/leaderboard.js';
registerCommand(pingCommand);
registerCommand(rankCommand);
registerCommand(leaderboardCommand);

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
});

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
