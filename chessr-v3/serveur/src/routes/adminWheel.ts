/**
 * Wheel-of-fortune backend.
 *
 * The bot owns the user-facing UX (slash commands, embeds, dropdowns).
 * The serveur owns the data: tokens (wheel_tokens), rewards
 * (wheel_rewards), the actual dice roll, and the chessr-side plan
 * application. Bot trust is reduced by having the serveur:
 *
 *   - roll the wheel itself (bot can't mint a lifetime by lying)
 *   - decide reward_path itself by reading user_settings + subscriptions
 *     (bot can't smuggle a paddle path on a non-paddle user)
 *   - read reward_days from the row (bot can't extend by 999d)
 *
 * Endpoints (all admin-token-gated):
 *
 *   POST   /admin/wheel/token/record       — idempotent INSERT
 *   GET    /admin/wheel/inventory          — tokens + rewards for owner
 *   POST   /admin/wheel/spin               — atomic: pick oldest token,
 *                                            roll wheel, write reward
 *   POST   /admin/wheel/claim              — atomic: apply reward to
 *                                            chessr account
 *   POST   /admin/wheel/gift               — atomic: change owner
 *
 * The wheel_* events are emitted at each transition so the dashboard
 * activity feed (later) and forensic audit can reconstruct full
 * histories without a dedicated gift_log table.
 */

import { Hono, type Context } from 'hono';
import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';
import { supabase } from '../lib/supabase.js';
import { rollWheel, type WheelOutcome } from '../lib/wheel.js';

export const adminWheelRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// ─── POST /admin/wheel/token/record ──────────────────────────────────────
// Bot calls this when a boost is detected (or on boot reconciliation,
// or for purchases / admin grants in the future). Idempotent on
// (owner_discord_id, source, external_ref): a duplicate event is a no-op.

adminWheelRoutes.post('/admin/wheel/token/record', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string; source?: string; externalRef?: string | null };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { discordId, source } = body;
  const externalRef = body.externalRef ?? null;
  if (!discordId || !source) return c.json({ error: 'discordId, source required' }, 400);
  if (!['boost', 'purchase', 'admin_grant'].includes(source)) {
    return c.json({ error: 'invalid source' }, 400);
  }

  const rows = await dbQuery<{ id: number }>(
    `INSERT INTO wheel_tokens (owner_discord_id, source, external_ref)
     VALUES ($1, $2, $3)
     ON CONFLICT (owner_discord_id, source, external_ref)
       WHERE external_ref IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [discordId, source, externalRef],
  );

  if (rows.length > 0) {
    await emitEvent({
      type: 'wheel_token_earned',
      payload: { tokenId: rows[0].id, source, externalRef, discordId },
    });
  }
  return c.json({ recorded: rows.length > 0, tokenId: rows[0]?.id ?? null });
});

// ─── GET /admin/wheel/inventory?discordId=… ──────────────────────────────

adminWheelRoutes.get('/admin/wheel/inventory', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const discordId = c.req.query('discordId');
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  const tokens = await dbQuery<{ id: number; source: string; earned_at: string }>(
    `SELECT id, source, earned_at
       FROM wheel_tokens
      WHERE owner_discord_id = $1 AND spun_at IS NULL
      ORDER BY earned_at ASC`,
    [discordId],
  );

  const rewards = await dbQuery<{
    id: number;
    reward_kind: string;
    reward_days: number | null;
    spun_at: string;
    spun_by_discord_id: string;
    gifted_from_discord_id: string | null;
    gifted_at: string | null;
  }>(
    `SELECT id, reward_kind, reward_days, spun_at,
            spun_by_discord_id, gifted_from_discord_id, gifted_at
       FROM wheel_rewards
      WHERE owner_discord_id = $1 AND claimed_at IS NULL
      ORDER BY spun_at DESC
      LIMIT 25`,
    [discordId],
  );

  return c.json({ tokens, rewards });
});

// ─── POST /admin/wheel/spin ──────────────────────────────────────────────
// Atomic: pick the oldest unspun token (FOR UPDATE SKIP LOCKED so two
// concurrent spins from the same caller don't collide), roll the wheel
// server-side, INSERT the reward, UPDATE the token. Emit wheel_spin.
// Returns null result when the caller has no token to spin.

adminWheelRoutes.post('/admin/wheel/spin', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { discordId } = body;
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  // Roll first — pure compute, doesn't need to be in the DB transaction.
  const outcome: WheelOutcome = rollWheel();

  // Single statement using a CTE: lock the oldest unspun token, then
  // create the reward, then mark the token spun. If no token exists,
  // both inserts produce zero rows and we return { spun: false }.
  const result = await dbQuery<{
    token_id: number;
    reward_id: number;
    reward_kind: string;
    reward_days: number | null;
  }>(
    `WITH t AS (
       SELECT id FROM wheel_tokens
       WHERE owner_discord_id = $1 AND spun_at IS NULL
       ORDER BY earned_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     ),
     r AS (
       INSERT INTO wheel_rewards
         (owner_discord_id, spun_by_discord_id, source_token_id, reward_kind, reward_days)
       SELECT $1, $1, t.id, $2, $3
       FROM t
       RETURNING id, reward_kind, reward_days
     ),
     u AS (
       UPDATE wheel_tokens
          SET spun_at = now(), reward_id = (SELECT id FROM r)
        WHERE id = (SELECT id FROM t)
       RETURNING id
     )
     SELECT t.id AS token_id, r.id AS reward_id,
            r.reward_kind, r.reward_days
     FROM t JOIN r ON true JOIN u ON true`,
    [discordId, outcome.kind, outcome.kind === 'days' ? outcome.value : null],
  );

  if (result.length === 0) return c.json({ spun: false });

  const row = result[0];
  await emitEvent({
    type: 'wheel_spin',
    payload: {
      tokenId: row.token_id,
      rewardId: row.reward_id,
      rewardKind: row.reward_kind,
      rewardDays: row.reward_days,
      discordId,
    },
  });

  return c.json({
    spun: true,
    tokenId: row.token_id,
    rewardId: row.reward_id,
    rewardKind: row.reward_kind,
    rewardDays: row.reward_days,
  });
});

// ─── POST /admin/wheel/claim ─────────────────────────────────────────────
// Caller passes (rewardId, callerDiscordId). Server resolves the chessr
// user_id from user_settings (caller must be linked), reads the live
// reward_kind / reward_days from the row, decides reward_path itself,
// applies the extension, and atomically marks the row claimed.

adminWheelRoutes.post('/admin/wheel/claim', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { rewardId?: number; callerDiscordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const rewardId = Number(body.rewardId);
  const { callerDiscordId } = body;
  if (!Number.isFinite(rewardId) || !callerDiscordId) {
    return c.json({ error: 'rewardId, callerDiscordId required' }, 400);
  }

  // 1. Read the reward — must exist, be owned by caller, and unclaimed.
  const reward = await dbQuery<{
    id: number;
    reward_kind: 'days' | 'lifetime';
    reward_days: number | null;
  }>(
    `SELECT id, reward_kind, reward_days
       FROM wheel_rewards
      WHERE id = $1 AND owner_discord_id = $2 AND claimed_at IS NULL`,
    [rewardId, callerDiscordId],
  );
  if (reward.length === 0) return c.json({ error: 'not_owner_or_already_claimed' }, 404);
  const rew = reward[0];

  // Lifetime rewards are processed manually via support ticket. Bot
  // shows the user where to go. We don't touch user_settings.
  if (rew.reward_kind === 'lifetime') {
    return c.json({ error: 'lifetime_manual', message: 'Lifetime rewards require a support ticket.' }, 409);
  }

  // 2. Resolve chessr user via discord link.
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, plan_expiry')
    .eq('discord_id', callerDiscordId)
    .maybeSingle();
  if (!settings) return c.json({ error: 'not_linked' }, 409);

  const plan = settings.plan as string;
  // Already-lifetime / beta users have no expiry to extend. Tell the
  // bot so it can suggest gifting instead.
  if (plan === 'lifetime' || plan === 'beta') {
    return c.json({ error: 'plan_no_extend', plan }, 409);
  }

  // 3. Decide reward_path server-side. We don't trust the bot to pick.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id, status, canceled_at')
    .eq('user_id', settings.user_id)
    .maybeSingle();
  const isActivePaddle =
    !!sub?.paddle_subscription_id &&
    sub.status !== 'canceled' &&
    !sub.canceled_at;
  const rewardPath: 'paddle' | 'dashboard' = isActivePaddle ? 'paddle' : 'dashboard';

  // 4. Atomic claim — lock the row before applying the extension.
  const claimRes = await dbQuery<{ id: number }>(
    `UPDATE wheel_rewards
        SET claimed_at = now(),
            claimed_by_user_id = $1,
            reward_path = $2
      WHERE id = $3
        AND owner_discord_id = $4
        AND claimed_at IS NULL
      RETURNING id`,
    [settings.user_id, rewardPath, rewardId, callerDiscordId],
  );
  if (claimRes.length === 0) return c.json({ error: 'claim_race_lost' }, 409);

  // 5. Apply the extension. If it fails, rollback the claim so the
  // user can retry on the next click.
  try {
    if (rewardPath === 'dashboard') {
      await extendDashboard(settings.user_id, plan, settings.plan_expiry, rew.reward_days!);
    } else {
      await extendPaddle(settings.user_id, rew.reward_days!);
    }
  } catch (err) {
    await dbQuery(
      `UPDATE wheel_rewards
          SET claimed_at = NULL, claimed_by_user_id = NULL, reward_path = NULL
        WHERE id = $1`,
      [rewardId],
    );
    console.error('[admin/wheel/claim] extend failed, rolled back:', err);
    return c.json({ error: 'extend_failed', message: String(err) }, 500);
  }

  await emitEvent({
    type: 'wheel_claim',
    user_id: settings.user_id,
    payload: {
      rewardId,
      rewardKind: rew.reward_kind,
      rewardDays: rew.reward_days,
      rewardPath,
      discordId: callerDiscordId,
    },
  });

  return c.json({
    claimed: true,
    rewardKind: rew.reward_kind,
    rewardDays: rew.reward_days,
    rewardPath,
    userId: settings.user_id,
  });
});

// ─── POST /admin/wheel/gift ──────────────────────────────────────────────
// Atomic ownership transfer. Caller is the current owner (validated by
// the WHERE clause on owner_discord_id).

adminWheelRoutes.post('/admin/wheel/gift', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { rewardId?: number; fromDiscordId?: string; toDiscordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const rewardId = Number(body.rewardId);
  const { fromDiscordId, toDiscordId } = body;
  if (!Number.isFinite(rewardId) || !fromDiscordId || !toDiscordId) {
    return c.json({ error: 'rewardId, fromDiscordId, toDiscordId required' }, 400);
  }
  if (fromDiscordId === toDiscordId) {
    return c.json({ error: 'cannot_gift_to_self' }, 400);
  }

  const rows = await dbQuery<{ id: number }>(
    `UPDATE wheel_rewards
        SET owner_discord_id = $1,
            gifted_from_discord_id = $2,
            gifted_at = now()
      WHERE id = $3
        AND owner_discord_id = $2
        AND claimed_at IS NULL
      RETURNING id`,
    [toDiscordId, fromDiscordId, rewardId],
  );

  if (rows.length === 0) return c.json({ error: 'not_owner_or_already_claimed' }, 409);

  await emitEvent({
    type: 'wheel_gift',
    payload: { rewardId, fromDiscordId, toDiscordId },
  });
  return c.json({ gifted: true });
});

// ─── Helpers (extend chessr account) ─────────────────────────────────────

function computeNewExpiry(currentExpiry: string | null, days: number): string {
  const base = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const start = Math.max(Date.now(), base);
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

async function extendDashboard(
  userId: string,
  oldPlan: string,
  oldExpiry: string | null,
  days: number,
): Promise<void> {
  const newExpiry = computeNewExpiry(oldExpiry, days);
  // Free / freetrial users get bumped to premium for the duration of
  // the wheel reward. Premium / beta keep their plan and just extend.
  const newPlan = oldPlan === 'free' || oldPlan === 'freetrial' ? 'premium' : oldPlan;

  const { error } = await supabase
    .from('user_settings')
    .update({
      plan: newPlan,
      plan_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw new Error(`user_settings update: ${error.message}`);

  // Drive role sync via the existing pipeline.
  await emitEvent({
    type: 'plan_changed',
    user_id: userId,
    payload: { oldPlan, newPlan, oldExpiry, newExpiry, reason: 'wheel_claim' },
  });
}

async function extendPaddle(userId: string, days: number): Promise<void> {
  // Reuse the existing extend endpoint logic: same atomic + same Paddle
  // SDK flow. Done via internal HTTP call to keep the responsibility
  // co-located with the rest of /admin/paddle.
  const adminToken = process.env.ADMIN_TOKEN || '';
  const port = Number(process.env.PORT) || 8080;
  const res = await fetch(`http://localhost:${port}/admin/paddle/extend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ userId, days, reason: 'wheel_claim' }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`paddle extend HTTP ${res.status}: ${json.error ?? ''}`);
  }
}
