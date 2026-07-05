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

export const FREE_TRIAL_DAYS = 3;

export type ClaimResult =
  | { ok: true; plan: 'freetrial'; expiresAt: string }
  | { ok: false; reason: 'not_eligible' | 'already_used' | 'paid_plan' | 'not_found' | 'db_error' | 'discord_already_used' };

export async function claimFreeTrial(userId: string, actorId?: string | null): Promise<ClaimResult> {
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
        return { ok: false, reason: 'discord_already_used' };
      }
    } catch (err) {
      // If the analytics DB is unreachable we don't want to block
      // legit claims indefinitely — log and fail open. The
      // `freetrial_used` per-account gate is still in place above.
      console.warn('[freetrial.claim] discord-history check failed:', err);
    }
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

  const result = await claimFreeTrial(userId);
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404
                 : result.reason === 'db_error' ? 500
                 : 409;
    return c.json({ ok: false, reason: result.reason }, status);
  }
  return c.json(result);
});

export { app as freetrialRoutes };
