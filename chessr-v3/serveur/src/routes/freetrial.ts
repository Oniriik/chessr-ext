/**
 * Free-trial claim endpoint.
 *
 * Idempotent grant of a 3-day freetrial plan, gated on:
 *   - user must currently be on `free` plan (we never override a paid sub)
 *   - user must not have ever claimed before (`freetrial_used = false`)
 *
 * Same primitive is used in two flows:
 *   1. Explicit click on the "claim free trial" CTA in the extension's
 *      system-message widget (POST /freetrial/claim)
 *   2. Automatic grant when the user successfully links Discord for the
 *      first time (called inline in routes/discord.ts after save). For
 *      the auto path we expose `claimFreeTrial(userId)` so the caller
 *      doesn't have to round-trip through HTTP.
 *
 * On success we update user_settings, emit `plan_changed` so the bot
 * picks up the role assignment, and return the new expiry.
 */

import { Hono } from 'hono';
import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/events.js';
import { dbQuery } from '../lib/db.js';
import { getClientIp } from './abuse.js';

export const FREE_TRIAL_DAYS = 3;

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN  = process.env.DISCORD_BOT_TOKEN;
const NOTIF_CHAN = process.env.DISCORD_NOTIFICATION_CHANNEL_ID;

/** Fire-and-forget mod-channel embed when a trial claim is denied by an
 *  anti-abuse gate — real-time visibility on farming attempts. */
function notifyTrialDenied(args: { userId: string; reason: string; siblingUserId?: string | null; discordId?: string | null }): void {
  if (!BOT_TOKEN || !NOTIF_CHAN) return;
  const fields = [
    { name: '👤 User', value: `\`${args.userId}\``, inline: true },
    { name: '🔑 Reason', value: args.reason, inline: true },
  ];
  if (args.siblingUserId) fields.push({ name: '🔗 Matched account', value: `\`${args.siblingUserId}\``, inline: true });
  if (args.discordId) fields.push({ name: '💬 Discord ID', value: `\`${args.discordId}\``, inline: true });
  fetch(`${DISCORD_API}/channels/${NOTIF_CHAN}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` },
    body: JSON.stringify({
      embeds: [{
        title: '🎟️ Free-trial claim denied',
        color: 0xf59e0b,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'chessr.io' },
      }],
    }),
  }).catch((err) => console.warn('[freetrial.claim] discord notify:', err));
}

export type ClaimResult =
  | { ok: true; plan: 'freetrial'; expiresAt: string }
  | { ok: false; reason: 'not_eligible' | 'already_used' | 'paid_plan' | 'not_found' | 'db_error' | 'discord_already_used' | 'device_already_used' | 'ip_already_used' };

export async function claimFreeTrial(userId: string, actorId?: string | null, clientIp?: string | null): Promise<ClaimResult> {
  if (!userId) return { ok: false, reason: 'not_found' };

  const { data: prev } = await supabase
    .from('user_settings')
    .select('plan, freetrial_used, plan_expiry, discord_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!prev) return { ok: false, reason: 'not_found' };
  if (prev.freetrial_used) return { ok: false, reason: 'already_used' };
  // Never override an active paid plan — even if `freetrial_used` is
  // false (e.g. user upgraded straight to premium without trying the
  // trial), we don't want to retroactively shorten their access.
  if (prev.plan && prev.plan !== 'free') return { ok: false, reason: 'paid_plan' };

  // Anti-abuse: a user could create chessr account A, link Discord X,
  // claim → unlink → create account B with a new email, link the SAME
  // Discord X again, and claim a second time (B has freetrial_used=
  // false by default). To close that, we query the events log for any
  // prior `freetrial_claimed` whose payload.discordId matches the
  // currently-linked Discord. If found, deny — even though the chessr
  // account itself is fresh.
  // Note: this only fires when the *current* claim attempt has a
  // linked Discord (the auto-claim path always does). Trials granted
  // through some future no-Discord path would skip this guard, which
  // is fine since they don't establish a discord_id fingerprint to
  // dodge in the first place.
  if (prev.discord_id) {
    try {
      const rows = await dbQuery<{ exists: boolean }>(
        `SELECT 1 AS exists
         FROM events
         WHERE type = 'freetrial_claimed'
           AND payload->>'discordId' = $1
         LIMIT 1`,
        [prev.discord_id],
      );
      if (rows.length > 0) {
        // Burn the trial on THIS account too: the linked Discord already
        // claimed one elsewhere, so this account must stop being offered
        // the trial (extension CTAs key off freetrial_used) — including
        // after unlinking and relinking a fresh Discord.
        const { error: flagError } = await supabase
          .from('user_settings')
          .update({ freetrial_used: true })
          .eq('user_id', userId);
        if (flagError) {
          console.warn('[freetrial.claim] failed to flag freetrial_used on discord_already_used:', flagError.message);
        }
        notifyTrialDenied({ userId, reason: 'discord_already_used', discordId: prev.discord_id });
        return { ok: false, reason: 'discord_already_used' };
      }
    } catch (err) {
      // If the analytics DB is unreachable we don't want to block
      // legit claims indefinitely — log and fail open. The
      // `freetrial_used` per-account gate is still in place above.
      console.warn('[freetrial.claim] discord-history check failed:', err);
    }
  }

  // No-footprint gate: user_fingerprints / signup_ips rows are written on
  // every signup AND login through the extension. An account with neither
  // has never run the extension — the only way to reach a claim in that
  // state is a raw API script. Deny; the first real login through the
  // extension writes the footprint and unblocks the claim.
  try {
    const [{ count: fpCount }, { count: ipCount }] = await Promise.all([
      supabase.from('user_fingerprints').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('signup_ips').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);
    if ((fpCount ?? 0) === 0 && (ipCount ?? 0) === 0) {
      await emitEvent({
        type: 'freetrial_denied',
        user_id: userId,
        payload: { reason: 'no_footprint', discordId: prev.discord_id ?? null },
      });
      notifyTrialDenied({ userId, reason: 'no_footprint', discordId: prev.discord_id ?? null });
      return { ok: false, reason: 'not_eligible' };
    }
  } catch (err) {
    console.warn('[freetrial.claim] footprint presence check failed:', err);
  }

  // Anti-abuse via the device/network footprint (user_fingerprints +
  // signup_ips, populated on every signup AND login by /report-signup).
  // Discord accounts are free to farm; the browser fingerprint isn't.
  //
  //   - fingerprint sibling with a consumed trial → hard deny + burn this
  //     account's trial too (same device ⇒ same person, deterministic).
  //   - IP sibling with a consumed trial → soft deny, NO burn —
  //     carrier-grade NAT and shared households make IP-only matches
  //     false-positive-prone, so the account isn't permanently flagged
  //     (a farmer rotating VPNs still gets caught by the fingerprint
  //     gate). No time window: all-time matching.
  //
  // Both fail open on DB errors — the per-account + discord gates above
  // still hold.
  try {
    const { data: fpRows } = await supabase
      .from('user_fingerprints')
      .select('fingerprint')
      .eq('user_id', userId);
    const fingerprints = (fpRows ?? []).map((r) => r.fingerprint as string);
    if (fingerprints.length > 0) {
      const { data: sib } = await supabase
        .from('user_fingerprints')
        .select('user_id')
        .in('fingerprint', fingerprints)
        .neq('user_id', userId);
      const siblingIds = [...new Set((sib ?? []).map((r) => r.user_id as string))];
      if (siblingIds.length > 0) {
        const { data: used } = await supabase
          .from('user_settings')
          .select('user_id')
          .in('user_id', siblingIds)
          .eq('freetrial_used', true)
          .limit(1);
        if (used && used.length > 0) {
          const { error: flagError } = await supabase
            .from('user_settings')
            .update({ freetrial_used: true })
            .eq('user_id', userId);
          if (flagError) console.warn('[freetrial.claim] flag on device_already_used failed:', flagError.message);
          await emitEvent({
            type: 'freetrial_denied',
            user_id: userId,
            payload: { reason: 'device_already_used', siblingUserId: used[0].user_id, discordId: prev.discord_id ?? null },
          });
          notifyTrialDenied({ userId, reason: 'device_already_used', siblingUserId: used[0].user_id, discordId: prev.discord_id ?? null });
          return { ok: false, reason: 'device_already_used' };
        }
      }
    }

    const { data: ipRows } = await supabase
      .from('signup_ips')
      .select('ip_address')
      .eq('user_id', userId);
    const ips = new Set((ipRows ?? []).map((r) => r.ip_address as string));
    if (clientIp) ips.add(clientIp);
    if (ips.size > 0) {
      const { data: ipSib } = await supabase
        .from('signup_ips')
        .select('user_id')
        .in('ip_address', [...ips])
        .neq('user_id', userId);
      const ipSiblingIds = [...new Set((ipSib ?? []).map((r) => r.user_id as string))];
      if (ipSiblingIds.length > 0) {
        const { data: used } = await supabase
          .from('user_settings')
          .select('user_id')
          .in('user_id', ipSiblingIds)
          .eq('freetrial_used', true)
          .limit(1);
        if (used && used.length > 0) {
          await emitEvent({
            type: 'freetrial_denied',
            user_id: userId,
            payload: { reason: 'ip_already_used', siblingUserId: used[0].user_id, discordId: prev.discord_id ?? null },
          });
          notifyTrialDenied({ userId, reason: 'ip_already_used', siblingUserId: used[0].user_id, discordId: prev.discord_id ?? null });
          return { ok: false, reason: 'ip_already_used' };
        }
      }
    }
  } catch (err) {
    console.warn('[freetrial.claim] footprint check failed:', err);
  }

  const expiresAt = new Date(Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('user_settings')
    .update({
      plan: 'freetrial',
      plan_expiry: expiresAt,
      freetrial_used: true,
    })
    .eq('user_id', userId);

  if (error) {
    console.error('[freetrial.claim] update failed:', error.message);
    return { ok: false, reason: 'db_error' };
  }

  // Two emits, one logical action:
  //   - plan_changed: drives the bot's role sync (Free → Freetrial) via
  //     the existing handler that watches every plan transition.
  //   - freetrial_claimed: dedicated discriminator for activity feeds /
  //     dashboards / analytics ("how many claims this week"). Cheap to
  //     query without payload->>'reason' gymnastics.
  const sharedPayload = {
    oldPlan: 'free',
    newPlan: 'freetrial' as const,
    oldExpiry: prev.plan_expiry ?? null,
    newExpiry: expiresAt,
    discordId: prev.discord_id ?? null,
  };
  await emitEvent({
    type: 'plan_changed',
    user_id: userId,
    actor_id: actorId ?? null,
    payload: { ...sharedPayload, reason: 'freetrial_claim' },
  });
  await emitEvent({
    type: 'freetrial_claimed',
    user_id: userId,
    actor_id: actorId ?? null,
    payload: {
      expiresAt,
      durationDays: FREE_TRIAL_DAYS,
      discordId: prev.discord_id ?? null,
    },
  });

  return { ok: true, plan: 'freetrial', expiresAt };
}

const app = new Hono();

// User-facing endpoint. Auth is intentionally trust-on-userId for now —
// the call comes from the extension which knows its own user id from
// Supabase. If we want stricter guards later (verify access_token),
// add it here without breaking the auto-claim caller below.
app.post('/freetrial/claim', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return c.json({ ok: false, error: 'Missing userId' }, 400);

  const result = await claimFreeTrial(userId, null, getClientIp(c));
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404
                 : result.reason === 'db_error' ? 500
                 : 409;
    return c.json({ ok: false, reason: result.reason }, status);
  }
  return c.json(result);
});

// One-shot ack for the "trial ended" modal — clears the stamp written by
// the plan-expiry sweeper so the extension never shows the modal twice.
// Same trust-on-userId model as /freetrial/claim above.
app.post('/freetrial/ended-ack', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return c.json({ ok: false, error: 'Missing userId' }, 400);

  const { error } = await supabase
    .from('user_settings')
    .update({ freetrial_ended_at: null })
    .eq('user_id', userId);
  if (error) {
    console.error('[freetrial.ended-ack] update failed:', error.message);
    return c.json({ ok: false }, 500);
  }
  return c.json({ ok: true });
});

export { app as freetrialRoutes };
