/**
 * Real-time ELO role sync on `elo_bracket_changed`.
 *
 * The serveur's elo-refresh cron updates linked_accounts ratings every
 * minute. When a user's cross-platform highest rating crosses a bracket
 * boundary it emits `elo_bracket_changed`; we react here by calling
 * syncEloRole so the Discord role flips within seconds.
 *
 * The 30-min guildRoleSync sweep stays as belt-and-suspenders for
 * anything we miss (bot offline at emit time, etc.).
 */

import { onEvent } from '../lib/events.js';
import { syncEloRole } from '../lib/discordRoles.js';
import { log } from '../lib/logger.js';

interface EloBracketChangedPayload {
  discordId?: string;
  newElo?: number;
  oldBracket?: number | null;
  newBracket?: number | null;
}

export function registerEloRoleEvents(): void {
  onEvent('elo_bracket_changed', async (e) => {
    const p = e.payload as EloBracketChangedPayload;
    if (!p.discordId || typeof p.newElo !== 'number') {
      log.warn('[elo-role] malformed elo_bracket_changed payload, skipping');
      return;
    }
    log.info(`[elo-role] ${p.discordId} bracket ${p.oldBracket ?? 'none'} → ${p.newBracket ?? 'none'} (rating ${p.newElo})`);
    await syncEloRole(p.discordId, p.newElo);
  });
}
