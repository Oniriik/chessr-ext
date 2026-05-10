/**
 * Platform-emoji cache.
 *
 * The Discord server hosts custom emojis named exactly like the
 * platform codes we store in `linked_accounts.platform`:
 *   - :chesscom:
 *   - :lichess:
 *   - :worldchess:
 *
 * Resolved server-side at boot from the configured guild's emoji
 * collection so no manual ID env var is needed — pop a new emoji in
 * Discord and it shows up after the next bot restart.
 *
 * Falls back to a unicode dot when the emoji isn't found (different
 * guild, emoji renamed, etc.) so the embed never crashes.
 */

import type { Client } from 'discord.js';
import { config } from '../config.js';
import { log } from './logger.js';

const cache = new Map<string, string>();

const FALLBACK = '•';

const EMOJI_NAMES = ['chesscom', 'lichess', 'worldchess'] as const;

/** Populate the cache from the configured guild. Safe to call multiple
 *  times — subsequent calls overwrite existing entries with the latest
 *  IDs (handles a manual emoji recreate without a process restart). */
export async function loadPlatformEmojis(client: Client): Promise<void> {
  const guildId = config.discord.guildId;
  if (!guildId) {
    log.warn('[emoji] DISCORD_GUILD_ID not set; platform emojis will use fallback');
    return;
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    log.warn(`[emoji] guild ${guildId} not reachable; platform emojis will use fallback`);
    return;
  }
  // Force a fresh fetch — the cache may be stale if a sysadmin just
  // added the emoji without restarting the bot.
  const emojis = await guild.emojis.fetch().catch(() => null);
  if (!emojis) return;

  for (const name of EMOJI_NAMES) {
    const e = emojis.find((em) => em.name === name);
    if (e) cache.set(name, e.toString());
  }
  log.info(`[emoji] resolved ${cache.size}/${EMOJI_NAMES.length} platform emojis`);
}

/** Format a platform code as the matching custom emoji string, or a
 *  unicode bullet when none is configured. */
export function platformEmoji(platform: string): string {
  return cache.get(platform) ?? FALLBACK;
}
