/**
 * DM tracker — listens for user→bot DMs and reports them to the serveur
 * so the admin dashboard can show open conversations + unread badges.
 *
 * The bot has no direct access to the local Postgres, so we forward via
 * POST /internal/dm-received (admin-token protected).
 */

import { ChannelType, type Client } from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export function registerDmTracker(client: Client): void {
  client.on('messageCreate', async (message) => {
    // Only real users, only DM channels
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.DM) return;

    const discordId = message.author.id;
    const channelId = message.channel.id;
    const preview   = (message.content || '(attachment)').slice(0, 150);

    try {
      const res = await fetch(`${config.serveur.url}/internal/dm-received`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': config.serveur.adminToken,
        },
        body: JSON.stringify({ discordId, channelId, preview }),
      });
      if (!res.ok) {
        log.warn(`[dmTracker] dm-received endpoint returned ${res.status}`);
      }
    } catch (err) {
      log.warn('[dmTracker] failed to report inbound DM:', err instanceof Error ? err.message : err);
    }
  });

  log.info('[dmTracker] DM tracking registered');
}
