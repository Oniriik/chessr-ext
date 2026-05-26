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

async function fetchEmail(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** Post an embed to a channel, retrying once on 429 with Retry-After. */
async function postEmbed(channelId: string, embed: object): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.discord.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '1');
      await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 10_000)));
      continue;
    }
    if (!res.ok) log.warn(`[planSync] channel post to ${channelId} failed: HTTP ${res.status}`);
    return;
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

function buildPlanEmbed(params: {
  discordId: string | null;
  email: string | null;
  oldPlan: string | null;
  newPlan: string;
  dmSent: boolean;
}): object {
  const { discordId, email, oldPlan, newPlan, dmSent } = params;

  let title: string;
  let color: number;
  if (newPlan === 'freetrial')                        { title = '🆓 Free trial started';  color = 0x22c55e; }
  else if (newPlan === 'premium')                     { title = '⭐ Premium activated';    color = 0xf59e0b; }
  else if (newPlan === 'lifetime')                    { title = '🌟 Lifetime activated';   color = 0xa855f7; }
  else if (newPlan === 'free' && oldPlan === 'freetrial') { title = '⏰ Free trial ended'; color = 0xef4444; }
  else if (newPlan === 'free' && oldPlan === 'premium')   { title = '⏰ Premium ended';    color = 0xef4444; }
  else { title = `🔄 ${oldPlan ?? '?'} → ${newPlan}`; color = 0x6b7280; }

  const parts: string[] = [];
  if (discordId) parts.push(`<@${discordId}>`);
  if (email) parts.push(`**${email}**`);
  const description = parts.length > 0 ? parts.join(' · ') : 'Unknown user';

  return {
    title,
    description,
    color,
    fields: [
      { name: 'Plan', value: `\`${oldPlan ?? '?'}\` → \`${newPlan}\``, inline: true },
      { name: 'DM',   value: discordId ? (dmSent ? '✉️ sent' : '📵 blocked') : '—', inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
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
    const newPlan = getString(e.payload, 'newPlan') ?? 'free';
    const oldPlan = getString(e.payload, 'oldPlan');
    const reason  = getString(e.payload, 'reason');

    // Role sync — only when Discord is linked.
    const discordId = getString(e.payload, 'discordId') ?? await lookupDiscordId(e.user_id);
    if (discordId) {
      await syncPlanRole(discordId, newPlan);
    } else {
      log.debug(`[planSync] plan_changed for ${e.user_id} — no discord linked`);
    }

    // DM the user if there's content and they have Discord.
    let dmSent = false;
    const msg = planChangedDM(oldPlan, newPlan, reason);
    if (msg && discordId) {
      dmSent = await sendDM(discordId, msg).catch((err) => {
        log.warn(`[planSync] plan DM to ${discordId} threw:`, err);
        return false;
      });
    }

    // Channel embed — eventForwarder.ts already posts a dedicated embed for
    // freetrial_claim (→ freetrial_claimed), wheel_* (→ wheel_claim), and
    // paddle_* (→ new_customer / customer_renewed / payment_failed). Posting
    // here too would double-post when planNotif == subscriptions channel.
    // We only need to post for plan_expired (cron-driven) and any future
    // reasons without a dedicated forwarded event.
    const notifChannelId = config.discord.mod.planNotif;
    const forwardedElsewhere =
      reason === 'freetrial_claim' ||
      reason === 'wheel_claim' ||
      reason === 'wheel_lifetime_claim' ||
      (reason !== null && reason.startsWith('paddle_'));
    if (notifChannelId && !forwardedElsewhere && msg !== null) {
      const email = await fetchEmail(e.user_id);
      const embed = buildPlanEmbed({ discordId, email, oldPlan, newPlan, dmSent });
      await postEmbed(notifChannelId, embed).catch((err) =>
        log.warn('[planSync] notif channel post threw:', err),
      );
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
