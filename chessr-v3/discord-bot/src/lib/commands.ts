/**
 * Slash-command registry.
 *
 * Each module under src/commands/ exports a `command` constant with two
 * fields: { data, execute }. `data` is the SlashCommandBuilder used at
 * registration time; `execute` runs on chatInputCommand interactions.
 *
 * Loading is explicit (one import per file in `index.ts`) rather than
 * filesystem-glob — TypeScript ESM + Node import semantics make globs
 * brittle in compiled output, and the explicit list catches dead files
 * at compile time.
 */

import {
  Client,
  ChatInputCommandInteraction,
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { config } from '../config.js';
import { log } from './logger.js';

export interface BotCommand {
  data: SlashCommandBuilder | Pick<SlashCommandBuilder, 'name' | 'toJSON'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const registry = new Map<string, BotCommand>();

/** Register a command. Called from index.ts once per imported module. */
export function registerCommand(cmd: BotCommand): void {
  registry.set(cmd.data.name, cmd);
}

/** Push the registry to Discord. Guild-scoped if DISCORD_GUILD_ID is set
 *  (instant), else global (≈1h propagation). Idempotent — Discord
 *  PUT-overwrites the existing set. */
export async function deployCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const body: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
  for (const cmd of registry.values()) body.push(cmd.data.toJSON());

  if (config.discord.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body },
    );
    log.info(`[commands] deployed ${body.length} guild-scoped to ${config.discord.guildId}`);
  } else {
    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body },
    );
    log.info(`[commands] deployed ${body.length} globally`);
  }
}

/** Hook the dispatcher onto the Discord client's interactionCreate. */
export function attachInteractionHandler(client: Client): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = registry.get(interaction.commandName);
    if (!cmd) {
      log.warn(`[commands] unknown command: ${interaction.commandName}`);
      return;
    }
    try {
      await cmd.execute(interaction);
    } catch (err) {
      log.error(`[commands] ${interaction.commandName} threw:`, err);
      const msg = 'Something went wrong running this command.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });
}
