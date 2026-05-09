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

export const FREE_TRIAL_DAYS = 3;

export type ClaimResult =
  | { ok: true; plan: 'freetrial'; expiresAt: string }
  | { ok: false; reason: 'not_eligible' | 'already_used' | 'paid_plan' | 'not_found' | 'db_error' };

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

  await emitEvent({
    type: 'plan_changed',
    user_id: userId,
    actor_id: actorId ?? null,
    payload: {
      oldPlan: 'free',
      newPlan: 'freetrial',
      oldExpiry: prev.plan_expiry ?? null,
      newExpiry: expiresAt,
      // Snapshot discord_id so the bot can sync the Freetrial role
      // without a round-trip — same pattern as the dashboard emitter.
      discordId: prev.discord_id ?? null,
      reason: 'freetrial_claim',
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
