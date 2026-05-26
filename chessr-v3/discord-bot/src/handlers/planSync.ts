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
import { config } from '../config.js';

const DISCORD_API = 'https://discord.com/api/v10';

/** Returns true if the message was delivered. */
async function sendDM(discordId: string, content: string): Promise<boolean> {
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.discord.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!dmRes.ok) {
    log.warn(`[planSync] failed to open DM channel for ${discordId}: HTTP ${dmRes.status}`);
    return false;
  }
  const { id: channelId } = await dmRes.json() as { id: string };

  const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.discord.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  if (!msgRes.ok) {
    log.warn(`[planSync] DM send to ${discordId} failed: HTTP ${msgRes.status}`);
    return false;
  }
  return true;
}

async function postToChannel(channelId: string, content: string): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.discord.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    log.warn(`[planSync] channel post to ${channelId} failed: HTTP ${res.status}`);
  }
}

/** Returns the DM text for a plan transition, or null when no DM should
 *  be sent (renewals, force-sync, bans, untracked tiers). */
function planChangedDM(
  oldPlan: string | null,
  newPlan: string,
  reason: string | null,
): string | null {
  if (oldPlan === newPlan) return null;               // renewal / force-sync
  if (reason === 'banned') return null;               // ban flow has its own messaging
  if (reason === 'admin_force_sync') return null;

  if (newPlan === 'freetrial') {
    return (
      '🆓 Your Chessr free trial has started! You have 3 days of full Premium access.\n' +
      'Enjoy unlimited analysis, suggestions and game reviews: https://chessr.io'
    );
  }
  if (newPlan === 'premium') {
    return (
      '⭐ Welcome to Chessr Premium! Your subscription is now active.\n' +
      'Enjoy unlimited analysis, suggestions and game reviews: https://chessr.io'
    );
  }
  if (newPlan === 'lifetime') {
    return (
      '🌟 Welcome to Chessr Lifetime! Enjoy unlimited access forever.\n' +
      'Thank you for your support: https://chessr.io'
    );
  }
  if (newPlan === 'free') {
    if (oldPlan === 'freetrial') {
      return (
        '⏰ Your Chessr free trial has ended.\n' +
        'Subscribe to Chessr Premium to keep full access to analysis, suggestions and game reviews: https://chessr.io'
      );
    }
    if (oldPlan === 'premium') {
      return (
        '⏰ Your Chessr Premium plan has ended.\n' +
        'Renew your subscription to keep full access to analysis, suggestions and game reviews: https://chessr.io'
      );
    }
  }
  return null;
}

/** Message posted in the plan-notif channel (admin-visible). Always fires
 *  alongside the DM attempt so admins can track plan changes in real time. */
function planNotifChannelMessage(
  discordId: string,
  oldPlan: string | null,
  newPlan: string,
  dmSent: boolean,
): string {
  const mention = `<@${discordId}>`;
  const dmTag = dmSent ? '✉️ DM sent' : '📵 DM blocked';
  if (newPlan === 'freetrial') return `🆓 ${mention} started a free trial — ${dmTag}`;
  if (newPlan === 'premium')   return `⭐ ${mention} activated Premium — ${dmTag}`;
  if (newPlan === 'lifetime')  return `🌟 ${mention} activated Lifetime — ${dmTag}`;
  if (newPlan === 'free') {
    if (oldPlan === 'freetrial') return `⏰ ${mention} free trial ended — ${dmTag}`;
    if (oldPlan === 'premium')   return `⏰ ${mention} Premium ended — ${dmTag}`;
  }
  return `🔄 ${mention} plan changed: ${oldPlan ?? '?'} → ${newPlan} — ${dmTag}`;
}

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
    const discordId = getString(e.payload, 'discordId') ?? await lookupDiscordId(e.user_id);
    if (!discordId) {
      log.debug(`[planSync] plan_changed for ${e.user_id} but no discord linked`);
      return;
    }
    const newPlan = getString(e.payload, 'newPlan') ?? 'free';
    await syncPlanRole(discordId, newPlan);

    const oldPlan = getString(e.payload, 'oldPlan');
    const reason  = getString(e.payload, 'reason');
    const msg = planChangedDM(oldPlan, newPlan, reason);
    if (!msg) return;

    const dmSent = await sendDM(discordId, msg).catch((err) => {
      log.warn(`[planSync] plan DM to ${discordId} threw:`, err);
      return false;
    });

    const notifChannelId = config.discord.mod.planNotif;
    if (notifChannelId) {
      await postToChannel(
        notifChannelId,
        planNotifChannelMessage(discordId, oldPlan, newPlan, dmSent),
      ).catch((err) => log.warn(`[planSync] notif channel post threw:`, err));
    }
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
