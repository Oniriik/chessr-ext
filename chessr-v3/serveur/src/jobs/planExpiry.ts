/**
 * Plan-expiry sweeper — runs every 15 minutes.
 *
 * Expires two categories of plans:
 *   1. freetrial — any user whose plan_expiry has passed.
 *   2. premium — any user whose plan_expiry has passed. Active Paddle
 *      subscriptions always have plan_expiry renewed before it elapses,
 *      so only dashboard-granted or lapsed Paddle subs appear here.
 *
 * For each expired user: plan → 'free', plan_expiry → null, plan cache
 * invalidated, and a plan_changed event emitted so the bot syncs Discord roles.
 *
 * Processes at most BATCH users per tick to keep the tick short. On heavy
 * backfill (e.g. first deploy after a downtime) the next tick will continue.
 */

import { supabase } from '../lib/supabase.js';
import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';
import { invalidatePlanCache } from '../lib/premium.js';

const BATCH = 10;

interface ExpiredRow {
  user_id: string;
  plan: string;
  plan_expiry: string;
  discord_id: string | null;
}

/** For users with no linked Discord, fall back to the most recent
 *  plan_changed event that carried a discordId in its payload.
 *  One batch query for all such users — returns a map user_id → discordId. */
async function fallbackDiscordIds(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await dbQuery<{ user_id: string; discord_id: string }>(
    `SELECT DISTINCT ON (user_id)
            user_id::text,
            payload->>'discordId' AS discord_id
       FROM events
      WHERE user_id = ANY($1::uuid[])
        AND type = 'plan_changed'
        AND payload->>'discordId' IS NOT NULL
      ORDER BY user_id, created_at DESC`,
    [userIds],
  );
  return new Map(rows.map((r) => [r.user_id, r.discord_id]));
}

export async function runPlanExpiry(): Promise<void> {
  const now = new Date().toISOString();

  // Two separate queries — simpler than nested or() PostgREST syntax and
  // easier to reason about independently.
  const [{ data: expiredTrials, error: e1 }, { data: expiredManual, error: e2 }] =
    await Promise.all([
      supabase
        .from('user_settings')
        .select('user_id, plan, plan_expiry, discord_id')
        .eq('plan', 'freetrial')
        .not('plan_expiry', 'is', null)
        .lt('plan_expiry', now)
        .limit(BATCH),
      supabase
        .from('user_settings')
        .select('user_id, plan, plan_expiry, discord_id')
        .eq('plan', 'premium')
        .not('plan_expiry', 'is', null)
        .lt('plan_expiry', now)
        .limit(BATCH),
    ]);

  if (e1) console.error('[plan-expiry] freetrial query failed:', e1.message);
  if (e2) console.error('[plan-expiry] premium query failed:', e2.message);

  const toExpire: ExpiredRow[] = [
    ...(expiredTrials ?? []),
    ...(expiredManual ?? []),
  ] as ExpiredRow[];

  if (toExpire.length === 0) return;

  // For users without a linked Discord, look up the most recent plan_changed
  // event that had a discordId — lets us still sync their role even if they
  // later unlinked their account.
  const noDiscord = toExpire.filter((u) => !u.discord_id).map((u) => u.user_id);
  const fallback = await fallbackDiscordIds(noDiscord).catch((err) => {
    console.warn('[plan-expiry] fallback discord lookup failed:', err);
    return new Map<string, string>();
  });

  let count = 0;
  for (const user of toExpire) {
    const patch: Record<string, unknown> = { plan: 'free', plan_expiry: null };
    // Stamp trial endings so the extension can show its one-shot
    // "trial ended" modal — cleared by POST /freetrial/ended-ack once
    // shown. DB-backed so the once-only survives reinstalls and is
    // shared across devices.
    if (user.plan === 'freetrial') patch.freetrial_ended_at = now;
    const { error: updateErr } = await supabase
      .from('user_settings')
      .update(patch)
      .eq('user_id', user.user_id)
      .eq('plan', user.plan); // guard against a concurrent plan change

    if (updateErr) {
      console.error(`[plan-expiry] update failed for ${user.user_id}:`, updateErr.message);
      continue;
    }

    invalidatePlanCache(user.user_id);

    await emitEvent({
      type: 'plan_changed',
      user_id: user.user_id,
      actor_id: null,
      payload: {
        oldPlan: user.plan,
        newPlan: 'free',
        oldExpiry: user.plan_expiry,
        newExpiry: null,
        reason: 'plan_expired',
        discordId: user.discord_id ?? fallback.get(user.user_id) ?? null,
      },
    });

    count++;
  }

  if (count > 0) {
    console.info(`[plan-expiry] expired ${count} plan(s)`);
  }
}
