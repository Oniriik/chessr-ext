/**
 * Plan ↔ Discord role sync handlers.
 *
 * Listens to three events from the shared bus:
 *   - plan_changed     → the user's plan changed; payload carries the
 *                        new plan AND the discord_id (snapshot at emit
 *                        time on the dashboard side)
 *   - discord_linked   → user just connected their Discord; we look up
 *                        their current plan from Supabase and assign
 *                        the matching role
 *   - discord_unlinked → user disconnected. The serveur enriches the
 *                        payload with the discord_id before clearing
 *                        the row, so we can still strip the role on the
 *                        now-orphaned member
 *   - user_banned      → ban downgrades plan to free + clears chess
 *                        accounts; we strip plan roles from their
 *                        Discord member
 *   - user_deleted     → user is gone; same treatment
 *
 * Why we trust the payload's discordId over a fresh DB lookup: by the
 * time the bot processes a `discord_unlinked` or `user_deleted`, the
 * row is gone. Snapshotting at emit time is the only reliable channel.
 * For `plan_changed` it's an optimization — saves a Supabase round-trip.
 */

import { onEvent, type IncomingEvent } from '../lib/events.js';
import { syncPlanRole } from '../lib/discordRoles.js';
import { supabase } from '../lib/supabase.js';
import { log } from '../lib/logger.js';

function getString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function lookupDiscordId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_settings')
    .select('discord_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.discord_id as string | null) ?? null;
}

async function lookupPlan(userId: string): Promise<string> {
  const { data } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.plan as string | null) ?? 'free';
}

export function registerPlanSyncHandlers(): void {
  onEvent('plan_changed', async (e: IncomingEvent) => {
    if (!e.user_id) return;
    // Prefer the snapshotted discord_id from the payload (fast path); fall
    // back to a Supabase lookup so we still work for any legacy emitter
    // that hasn't been updated to include it.
    const discordId = getString(e.payload, 'discordId') ?? await lookupDiscordId(e.user_id);
    if (!discordId) {
      log.debug(`[planSync] plan_changed for ${e.user_id} but no discord linked`);
      return;
    }
    const newPlan = getString(e.payload, 'newPlan') ?? 'free';
    await syncPlanRole(discordId, newPlan);
  });

  onEvent('discord_linked', async (e: IncomingEvent) => {
    if (!e.user_id) return;
    const discordId = getString(e.payload, 'discordId') ?? await lookupDiscordId(e.user_id);
    if (!discordId) return;
    // Plan isn't in this event's payload — fetch the current value.
    const plan = await lookupPlan(e.user_id);
    await syncPlanRole(discordId, plan);
  });

  onEvent('discord_unlinked', async (e: IncomingEvent) => {
    // user_settings.discord_id is already cleared by the time we get
    // here — the serveur snapshots it into the payload for us.
    const discordId = getString(e.payload, 'discordId');
    if (!discordId) {
      log.debug('[planSync] discord_unlinked without discordId in payload');
      return;
    }
    await syncPlanRole(discordId, null);
  });

  onEvent('user_banned', async (e: IncomingEvent) => {
    // Banned users get NO role (not even Free) — the ban downgrades
    // their plan to 'free' in user_settings, but on Discord we treat
    // this as a punitive de-tier rather than "now they're free".
    const discordId = getString(e.payload, 'discordId');
    if (!discordId) return;
    await syncPlanRole(discordId, null);
  });

  onEvent('user_unbanned', async (e: IncomingEvent) => {
    // Unban resets the ban flags but doesn't restore a prior plan; the
    // user is back to plain Free. Re-grant their Discord tier role if
    // they're still linked.
    if (!e.user_id) return;
    const discordId = await lookupDiscordId(e.user_id);
    if (!discordId) return;
    const plan = await lookupPlan(e.user_id);
    await syncPlanRole(discordId, plan);
  });

  onEvent('user_deleted', async (e: IncomingEvent) => {
    const discordId = getString(e.payload, 'discordId');
    if (!discordId) return;
    await syncPlanRole(discordId, null);
  });

  log.info('[planSync] handlers registered');
}
