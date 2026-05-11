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
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';
import { supabase } from '../lib/supabase.js';
import { rollWheel, type WheelOutcome } from '../lib/wheel.js';

// Lazy Paddle client — needed for the lifetime-apply path that cancels
// the user's active subscription. Re-initialised on each call to avoid
// importing the heavy SDK at module load when the env is missing.
function getPaddle(): Paddle | null {
  const key = process.env.PADDLE_API_KEY;
  if (!key) return null;
  const env = (process.env.PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production';
  return new Paddle(key, {
    environment: env === 'sandbox' ? Environment.sandbox : Environment.production,
  });
}

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

// ─── Token drops (admin-triggered "first to claim wins" event) ───────────
//
// Lifecycle:
//   1. Admin clicks "Drop token" in the dashboard → POST /admin/wheel/drop
//      The serveur inserts a wheel_drops row (status='open'), publishes
//      `wheel_drop_requested`, and returns the dropId + variant.
//   2. The bot subscribes to the event, posts the embed + button in the
//      configured channel, and calls /admin/wheel/drop/:id/posted with
//      the resulting message_id so the row is fully linked.
//   3. When a user clicks the button, the bot calls
//      /admin/wheel/drop/:id/claim. The atomic UPDATE …
//      WHERE status='open' RETURNING decides the winner — exactly one
//      caller can flip the row from 'open' to 'caught'.
//   4. The winner gets a wheel_tokens row minted with
//      source='admin_grant' and external_ref='drop:<id>' (unique index
//      on (owner, source, external_ref) double-guards against retries).
//      wheel_token_earned is emitted as usual.

// ─── POST /admin/wheel/drop ──────────────────────────────────────────────

adminWheelRoutes.post('/admin/wheel/drop', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { channelId?: string; variant?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const channelId = (body.channelId ?? '').trim();
  if (!channelId) return c.json({ error: 'channelId required' }, 400);

  // 0..4. Caller can pin a specific variant for QA; otherwise random.
  const variant = Number.isFinite(body.variant) && body.variant! >= 0 && body.variant! <= 4
    ? Math.floor(body.variant!)
    : Math.floor(Math.random() * 5);

  const rows = await dbQuery<{ id: number }>(
    `INSERT INTO wheel_drops (channel_id, variant)
     VALUES ($1, $2)
     RETURNING id`,
    [channelId, variant],
  );
  const dropId = rows[0].id;

  await emitEvent({
    type: 'wheel_drop_requested',
    payload: { dropId, channelId, variant },
  });

  return c.json({ dropId, variant, channelId });
});

// ─── POST /admin/wheel/drop/:id/posted ───────────────────────────────────

adminWheelRoutes.post('/admin/wheel/drop/:id/posted', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { messageId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const messageId = (body.messageId ?? '').trim();
  if (!messageId) return c.json({ error: 'messageId required' }, 400);

  // First-write-wins — once a message_id is set we ignore subsequent
  // updates (bot retried while we already had a successful post).
  const updated = await dbQuery<{ id: number }>(
    `UPDATE wheel_drops
        SET message_id = $1, posted_at = now()
      WHERE id = $2 AND message_id IS NULL
      RETURNING id`,
    [messageId, id],
  );
  return c.json({ updated: updated.length > 0 });
});

// ─── POST /admin/wheel/drop/:id/claim ────────────────────────────────────
// The race-safety pivot: only ONE caller can satisfy
// `WHERE status='open'` in the UPDATE below — PostgreSQL serialises the
// row-level write. The losing caller's UPDATE matches zero rows and
// `won` falls to false.

adminWheelRoutes.post('/admin/wheel/drop/:id/claim', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);

  let body: { discordId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const discordId = (body.discordId ?? '').trim();
  if (!discordId) return c.json({ error: 'discordId required' }, 400);

  // Atomic flip. Returns the dropped_at so we can compute the duration
  // in the same round-trip without a separate SELECT.
  const won = await dbQuery<{ dropped_at: string }>(
    `UPDATE wheel_drops
        SET status = 'caught',
            claimed_by_discord_id = $1,
            claimed_at = now()
      WHERE id = $2 AND status = 'open'
      RETURNING dropped_at`,
    [discordId, id],
  );

  if (won.length === 0) {
    // Someone beat us. Surface who + when so the bot can show a
    // helpful "@x caught it 0.3s before you" ephemeral message.
    const existing = await dbQuery<{
      claimed_by_discord_id: string | null;
      claimed_at: string | null;
      dropped_at: string;
    }>(
      `SELECT claimed_by_discord_id, claimed_at, dropped_at
         FROM wheel_drops WHERE id = $1`,
      [id],
    );
    return c.json({
      caught: false,
      claimedBy: existing[0]?.claimed_by_discord_id ?? null,
      claimedAt: existing[0]?.claimed_at ?? null,
      droppedAt: existing[0]?.dropped_at ?? null,
    });
  }

  // Won. Mint a wheel_token with a unique external_ref so retries are
  // no-ops (the (owner, source, external_ref) unique index does the
  // dedup). Link back from wheel_drops.token_id for the audit trail.
  const externalRef = `drop:${id}`;
  const tokens = await dbQuery<{ id: number }>(
    `INSERT INTO wheel_tokens (owner_discord_id, source, external_ref)
     VALUES ($1, 'admin_grant', $2)
     ON CONFLICT (owner_discord_id, source, external_ref)
       WHERE external_ref IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [discordId, externalRef],
  );
  const tokenId = tokens[0]?.id ?? null;
  if (tokenId !== null) {
    await dbQuery(`UPDATE wheel_drops SET token_id = $1 WHERE id = $2`, [tokenId, id]);
    await emitEvent({
      type: 'wheel_token_earned',
      payload: { tokenId, source: 'admin_grant', externalRef, discordId },
    });
  }

  const durationMs = Date.now() - new Date(won[0].dropped_at).getTime();
  return c.json({ caught: true, tokenId, durationMs });
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

// ─── GET /admin/wheel/stats ─────────────────────────────────────────────
// Aggregated counters for the Overview tab. Always-fresh — the volume
// is small enough that a SELECT COUNT query per call is fine.

adminWheelRoutes.get('/admin/wheel/stats', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const [
    tokensTotal, tokensUnspun, spinsTotal, claimsTotal, lifetimePending, lifetimeWonAll,
  ] = await Promise.all([
    dbQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM wheel_tokens`),
    dbQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM wheel_tokens WHERE spun_at IS NULL`),
    dbQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM wheel_rewards`),
    dbQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM wheel_rewards WHERE claimed_at IS NOT NULL`),
    dbQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM wheel_rewards WHERE reward_kind='lifetime' AND claimed_at IS NULL`),
    dbQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM wheel_rewards WHERE reward_kind='lifetime'`),
  ]);

  // Distribution per outcome — group by (kind, days). Days reward sort
  // ascending so the dashboard can render a 5d→365d→lifetime ramp.
  const distribution = await dbQuery<{
    reward_kind: 'days' | 'lifetime';
    reward_days: number | null;
    n: string;
  }>(
    `SELECT reward_kind, reward_days, COUNT(*)::text n
       FROM wheel_rewards
      GROUP BY reward_kind, reward_days
      ORDER BY (reward_kind = 'lifetime') ASC, reward_days ASC NULLS LAST`,
  );

  return c.json({
    tokensTotal: Number(tokensTotal[0]?.n ?? 0),
    tokensUnspun: Number(tokensUnspun[0]?.n ?? 0),
    spinsTotal: Number(spinsTotal[0]?.n ?? 0),
    claimsTotal: Number(claimsTotal[0]?.n ?? 0),
    lifetimePending: Number(lifetimePending[0]?.n ?? 0),
    lifetimeWonAll: Number(lifetimeWonAll[0]?.n ?? 0),
    distribution: distribution.map((r) => ({
      reward_kind: r.reward_kind,
      reward_days: r.reward_days,
      count: Number(r.n),
    })),
  });
});

// ─── GET /admin/wheel/tokens ────────────────────────────────────────────
// Paginated token list with optional filters.
//   ?source=boost|purchase|admin_grant
//   ?status=unspun|spun
//   ?discordId=…
//   &limit=  (default 50, max 200)
//   &offset= (default 0)

adminWheelRoutes.get('/admin/wheel/tokens', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const u = new URL(c.req.url);
  const source = u.searchParams.get('source');
  const status = u.searchParams.get('status');
  const discordId = u.searchParams.get('discordId');
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? '50')));
  const offset = Math.max(0, Number(u.searchParams.get('offset') ?? '0'));

  const where: string[] = [];
  const params: unknown[] = [];
  if (source && ['boost', 'purchase', 'admin_grant'].includes(source)) {
    params.push(source);
    where.push(`source = $${params.length}`);
  }
  if (status === 'unspun') where.push(`spun_at IS NULL`);
  else if (status === 'spun') where.push(`spun_at IS NOT NULL`);
  if (discordId) {
    params.push(discordId);
    where.push(`owner_discord_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await dbQuery<{
    id: number;
    owner_discord_id: string;
    source: string;
    external_ref: string | null;
    earned_at: string;
    spun_at: string | null;
    reward_id: number | null;
  }>(
    `SELECT id, owner_discord_id, source, external_ref,
            earned_at::text, spun_at::text, reward_id
       FROM wheel_tokens
       ${whereSql}
      ORDER BY earned_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const totalRow = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text n FROM wheel_tokens ${whereSql}`,
    params,
  );

  return c.json({ tokens: rows, total: Number(totalRow[0]?.n ?? 0), limit, offset });
});

// ─── GET /admin/wheel/spins ─────────────────────────────────────────────
// Same shape, on wheel_rewards.
//   ?kind=days|lifetime  &days=N  &discordId=…  (spinner)

adminWheelRoutes.get('/admin/wheel/spins', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const u = new URL(c.req.url);
  const kind = u.searchParams.get('kind');
  const days = u.searchParams.get('days');
  const discordId = u.searchParams.get('discordId');
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? '50')));
  const offset = Math.max(0, Number(u.searchParams.get('offset') ?? '0'));

  const where: string[] = [];
  const params: unknown[] = [];
  if (kind && ['days', 'lifetime'].includes(kind)) {
    params.push(kind);
    where.push(`reward_kind = $${params.length}`);
  }
  if (days) {
    const n = Number(days);
    if (Number.isFinite(n)) {
      params.push(n);
      where.push(`reward_days = $${params.length}`);
    }
  }
  if (discordId) {
    params.push(discordId);
    where.push(`spun_by_discord_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await dbQuery<{
    id: number;
    spun_by_discord_id: string;
    owner_discord_id: string;
    reward_kind: string;
    reward_days: number | null;
    spun_at: string;
    claimed_at: string | null;
    reward_path: string | null;
  }>(
    `SELECT id, spun_by_discord_id, owner_discord_id,
            reward_kind, reward_days,
            spun_at::text, claimed_at::text, reward_path
       FROM wheel_rewards
       ${whereSql}
      ORDER BY spun_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const totalRow = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text n FROM wheel_rewards ${whereSql}`,
    params,
  );

  return c.json({ spins: rows, total: Number(totalRow[0]?.n ?? 0), limit, offset });
});

// ─── GET /admin/wheel/gifts ─────────────────────────────────────────────
// Reads from the events table — wheel_gift events carry the full hop
// trail across re-gifts, which the wheel_rewards row alone can't show.

adminWheelRoutes.get('/admin/wheel/gifts', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const u = new URL(c.req.url);
  const discordId = u.searchParams.get('discordId');
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? '50')));
  const offset = Math.max(0, Number(u.searchParams.get('offset') ?? '0'));

  const where: string[] = [`type = 'wheel_gift'`];
  const params: unknown[] = [];
  if (discordId) {
    params.push(discordId);
    where.push(`(payload->>'fromDiscordId' = $${params.length} OR payload->>'toDiscordId' = $${params.length})`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const rows = await dbQuery<{
    id: string;
    created_at: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT id::text, created_at::text, payload
       FROM events
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const totalRow = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text n FROM events ${whereSql}`,
    params,
  );

  return c.json({ gifts: rows, total: Number(totalRow[0]?.n ?? 0), limit, offset });
});

// ─── GET /admin/wheel/claims ────────────────────────────────────────────
// Reward rows that have actually been applied to a chessr account.

adminWheelRoutes.get('/admin/wheel/claims', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const u = new URL(c.req.url);
  const path = u.searchParams.get('path');
  const discordId = u.searchParams.get('discordId');
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit') ?? '50')));
  const offset = Math.max(0, Number(u.searchParams.get('offset') ?? '0'));

  const where: string[] = [`claimed_at IS NOT NULL`];
  const params: unknown[] = [];
  if (path && ['paddle', 'dashboard', 'lifetime_set'].includes(path)) {
    params.push(path);
    where.push(`reward_path = $${params.length}`);
  }
  if (discordId) {
    params.push(discordId);
    where.push(`owner_discord_id = $${params.length}`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const rows = await dbQuery<{
    id: number;
    owner_discord_id: string;
    spun_by_discord_id: string;
    reward_kind: string;
    reward_days: number | null;
    reward_path: string | null;
    claimed_at: string;
    claimed_by_user_id: string;
  }>(
    `SELECT id, owner_discord_id, spun_by_discord_id,
            reward_kind, reward_days, reward_path,
            claimed_at::text, claimed_by_user_id
       FROM wheel_rewards
       ${whereSql}
      ORDER BY claimed_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const totalRow = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text n FROM wheel_rewards ${whereSql}`,
    params,
  );

  return c.json({ claims: rows, total: Number(totalRow[0]?.n ?? 0), limit, offset });
});

// ─── GET /admin/discord/usernames ───────────────────────────────────────
// Resolves a list of Discord IDs to chessr-known handles via
// user_settings.discord_username. Unknown IDs (Discord users not linked
// to a Chessr account) come back null so the client can fall back to
// the raw mention. Useful for any admin view that displays Discord IDs.

adminWheelRoutes.get('/admin/discord/usernames', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const idsParam = new URL(c.req.url).searchParams.get('ids') ?? '';
  const ids = [...new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return c.json({ usernames: {} });

  const { data } = await supabase
    .from('user_settings')
    .select('discord_id, discord_username')
    .in('discord_id', ids);

  const map: Record<string, string | null> = {};
  for (const id of ids) map[id] = null;
  for (const row of data ?? []) {
    if (row.discord_id) map[row.discord_id as string] = (row.discord_username as string | null) ?? null;
  }
  return c.json({ usernames: map });
});

// ─── GET /admin/wheel/activity ──────────────────────────────────────────
// Recent wheel_* events for the Overview tab's activity timeline.

adminWheelRoutes.get('/admin/wheel/activity', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const limit = Math.min(50, Math.max(1, Number(new URL(c.req.url).searchParams.get('limit') ?? '20')));

  const rows = await dbQuery<{
    id: string;
    type: string;
    created_at: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT id::text, type, created_at::text, payload
       FROM events
      WHERE type IN ('wheel_token_earned','wheel_spin','wheel_gift','wheel_claim')
      ORDER BY created_at DESC
      LIMIT ${limit}`,
  );
  return c.json({ events: rows });
});

// ─── POST /admin/wheel/token/grant ───────────────────────────────────────
// Bulk-mint admin_grant tokens for a user. Each row gets external_ref
// = null so the unique-index dedup is bypassed (you can grant the same
// user multiple times).
//
// Audit: each row produces a wheel_token_earned event with the actor
// user_id + reason in payload.

adminWheelRoutes.post('/admin/wheel/token/grant', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { discordId?: string; count?: number; reason?: string; actorUserId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { discordId } = body;
  const count = Number(body.count ?? 1);
  const reason = (body.reason ?? '').trim();
  if (!discordId) return c.json({ error: 'discordId required' }, 400);
  if (!reason) return c.json({ error: 'reason required' }, 400);
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    return c.json({ error: 'count must be 1..100' }, 400);
  }

  const created: number[] = [];
  for (let i = 0; i < count; i++) {
    const rows = await dbQuery<{ id: number }>(
      `INSERT INTO wheel_tokens (owner_discord_id, source, external_ref)
       VALUES ($1, 'admin_grant', NULL)
       RETURNING id`,
      [discordId],
    );
    const tokenId = rows[0].id;
    created.push(tokenId);
    await emitEvent({
      type: 'wheel_token_earned',
      actor_id: body.actorUserId ?? null,
      payload: {
        tokenId,
        source: 'admin_grant',
        externalRef: null,
        discordId,
        reason,
      },
    });
  }
  return c.json({ granted: created.length, tokenIds: created });
});

// ─── POST /admin/wheel/token/revoke ──────────────────────────────────────
// Delete an unspun token. Spun tokens stay — the resulting reward might
// already be in someone's inventory, deleting the token would orphan
// the source link.

adminWheelRoutes.post('/admin/wheel/token/revoke', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { tokenId?: number; actorUserId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const tokenId = Number(body.tokenId);
  if (!Number.isFinite(tokenId)) return c.json({ error: 'tokenId required' }, 400);

  const rows = await dbQuery<{ id: number; owner_discord_id: string; source: string }>(
    `DELETE FROM wheel_tokens
       WHERE id = $1 AND spun_at IS NULL
     RETURNING id, owner_discord_id, source`,
    [tokenId],
  );
  if (rows.length === 0) return c.json({ error: 'token_not_found_or_already_spun' }, 404);

  await emitEvent({
    type: 'wheel_token_earned', // reuse the kind with a synthetic payload — wheel_token_revoked could be added later
    actor_id: body.actorUserId ?? null,
    payload: {
      tokenId: rows[0].id,
      revoked: true,
      discordId: rows[0].owner_discord_id,
      source: rows[0].source,
    },
  });
  return c.json({ revoked: true });
});

// ─── GET /admin/wheel/pending-lifetime ───────────────────────────────────
// Lifetime rewards that admins still need to apply manually. Joined with
// auth.users (via Supabase) for email + chessr user_id, so the dashboard
// can render the apply modal in one round-trip.

interface PendingLifetimeRow {
  reward_id: number;
  spun_by_discord_id: string;
  owner_discord_id: string;
  spun_at: string;
  gifted_from_discord_id: string | null;
  gifted_at: string | null;
}

interface PendingLifetimeEnriched extends PendingLifetimeRow {
  owner_user_id: string | null;
  owner_email: string | null;
  owner_plan: string | null;
  owner_paddle_subscription_id: string | null;
  owner_paddle_status: string | null;
}

adminWheelRoutes.get('/admin/wheel/pending-lifetime', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  const rows = await dbQuery<PendingLifetimeRow>(
    `SELECT id AS reward_id,
            spun_by_discord_id,
            owner_discord_id,
            spun_at::text,
            gifted_from_discord_id,
            gifted_at::text
       FROM wheel_rewards
      WHERE reward_kind = 'lifetime' AND claimed_at IS NULL
      ORDER BY spun_at DESC`,
  );

  // Enrich each row with the owner's chessr identity + paddle state.
  // Done outside SQL because user_settings + auth lives on Supabase,
  // not on the local pg.
  const enriched: PendingLifetimeEnriched[] = await Promise.all(
    rows.map(async (r) => {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('user_id, plan')
        .eq('discord_id', r.owner_discord_id)
        .maybeSingle();

      let email: string | null = null;
      let paddleSubId: string | null = null;
      let paddleStatus: string | null = null;
      if (settings?.user_id) {
        const { data: auth } = await supabase.auth.admin.getUserById(settings.user_id);
        email = auth?.user?.email ?? null;
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('paddle_subscription_id, status')
          .eq('user_id', settings.user_id)
          .maybeSingle();
        paddleSubId = sub?.paddle_subscription_id ?? null;
        paddleStatus = sub?.status ?? null;
      }
      return {
        ...r,
        owner_user_id: settings?.user_id ?? null,
        owner_email: email,
        owner_plan: settings?.plan ?? null,
        owner_paddle_subscription_id: paddleSubId,
        owner_paddle_status: paddleStatus,
      };
    }),
  );

  return c.json({ rewards: enriched });
});

// ─── GET /admin/wheel/pending-lifetime/count ─────────────────────────────
// Lightweight version for the sidebar badge — no user enrichment.

adminWheelRoutes.get('/admin/wheel/pending-lifetime/count', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  const rows = await dbQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM wheel_rewards
      WHERE reward_kind = 'lifetime' AND claimed_at IS NULL`,
  );
  return c.json({ count: Number(rows[0]?.count ?? '0') });
});

// ─── POST /admin/wheel/apply-lifetime ────────────────────────────────────
// Super-admin only (gated at the dashboard route layer; the serveur
// trusts the admin token here).
//
// Applies a pending lifetime reward end-to-end:
//   1. Mark reward claimed (atomic)
//   2. If user has an active Paddle sub, cancel it immediately (no
//      refund — Paddle's default for cancel-immediate is to NOT issue
//      a credit note unless requested separately)
//   3. Set user_settings.plan = 'lifetime', plan_expiry = null
//   4. Emit plan_changed (drives Discord role sync via the bus)
//
// Failures roll back the claim so the admin can retry.

adminWheelRoutes.post('/admin/wheel/apply-lifetime', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);

  let body: { rewardId?: number; actorUserId?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const rewardId = Number(body.rewardId);
  if (!Number.isFinite(rewardId)) return c.json({ error: 'rewardId required' }, 400);

  // 1. Read reward + verify it's a pending lifetime.
  const reward = await dbQuery<{
    id: number;
    owner_discord_id: string;
    reward_kind: 'days' | 'lifetime';
  }>(
    `SELECT id, owner_discord_id, reward_kind
       FROM wheel_rewards
      WHERE id = $1 AND claimed_at IS NULL`,
    [rewardId],
  );
  if (reward.length === 0) return c.json({ error: 'not_found_or_already_claimed' }, 404);
  if (reward[0].reward_kind !== 'lifetime') return c.json({ error: 'not_a_lifetime' }, 400);

  // 2. Resolve owner's chessr account.
  const { data: settings } = await supabase
    .from('user_settings')
    .select('user_id, plan, plan_expiry')
    .eq('discord_id', reward[0].owner_discord_id)
    .maybeSingle();
  if (!settings) return c.json({ error: 'owner_not_linked' }, 409);

  // 3. Lock the row by stamping claimed_at first. If anyone else stole
  // the claim, we bail.
  const claim = await dbQuery<{ id: number }>(
    `UPDATE wheel_rewards
        SET claimed_at = now(),
            claimed_by_user_id = $1,
            reward_path = 'lifetime_set'
      WHERE id = $2 AND claimed_at IS NULL
      RETURNING id`,
    [settings.user_id, rewardId],
  );
  if (claim.length === 0) return c.json({ error: 'claim_race_lost' }, 409);

  // From here on, any failure rolls the claim back.
  try {
    // 4. Cancel any active Paddle subscription. effectiveFrom:
    // 'immediately' ends the sub now and Paddle does NOT auto-refund
    // the prorated unused portion — the customer keeps the period
    // they already paid for as consumed, no money back.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('paddle_subscription_id, status, canceled_at')
      .eq('user_id', settings.user_id)
      .maybeSingle();
    const isActivePaddle =
      !!sub?.paddle_subscription_id &&
      sub.status !== 'canceled' &&
      !sub.canceled_at;
    if (isActivePaddle) {
      const paddle = getPaddle();
      if (!paddle) throw new Error('paddle SDK not configured');
      await paddle.subscriptions.cancel(sub!.paddle_subscription_id!, {
        effectiveFrom: 'immediately',
      });
    }

    // 5. Set lifetime in user_settings.
    const { error: updErr } = await supabase
      .from('user_settings')
      .update({
        plan: 'lifetime',
        plan_expiry: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', settings.user_id);
    if (updErr) throw new Error(`user_settings update: ${updErr.message}`);

    // 6. Drive role sync via the events bus.
    await emitEvent({
      type: 'plan_changed',
      user_id: settings.user_id,
      actor_id: body.actorUserId ?? null,
      payload: {
        oldPlan: settings.plan,
        newPlan: 'lifetime',
        oldExpiry: settings.plan_expiry,
        newExpiry: null,
        reason: 'wheel_lifetime_claim',
      },
    });

    await emitEvent({
      type: 'wheel_claim',
      user_id: settings.user_id,
      actor_id: body.actorUserId ?? null,
      payload: {
        rewardId,
        rewardKind: 'lifetime',
        rewardPath: 'lifetime_set',
        discordId: reward[0].owner_discord_id,
      },
    });

    return c.json({ applied: true, userId: settings.user_id });
  } catch (err) {
    // Roll the claim back — admin can retry.
    await dbQuery(
      `UPDATE wheel_rewards
          SET claimed_at = NULL,
              claimed_by_user_id = NULL,
              reward_path = NULL
        WHERE id = $1`,
      [rewardId],
    );
    console.error('[admin/wheel/apply-lifetime] failed, rolled back:', err);
    return c.json({ error: 'apply_failed', message: String(err) }, 500);
  }
});
