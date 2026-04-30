/**
 * Paddle billing handlers (Hono).
 *
 * Ported from chessr-next/serveur/src/handlers/paddleHandler.ts (raw Node
 * http) — same protocol, same Supabase tables, same Paddle SDK usage.
 * The DNS-flip migration plan: when this v3 server takes over from v2,
 * we just point engine.chessr.io's A-record at the v3 IP. Paddle's
 * webhook endpoint URL doesn't change, dashboard stays untouched.
 *
 * This first commit lands ONLY:
 *   - POST /api/paddle/webhook        — receives Paddle events, syncs Supabase
 *   - POST /api/paddle/billing-link   — issues a signed billing token used
 *                                        by chessr.io/checkout for tokenized
 *                                        plan operations
 *
 * Subsequent endpoints (status / switch / cancel / preview-upgrade /
 * upgrade-lifetime / prices) come in follow-up commits to keep review
 * surface manageable.
 */

import type { Context } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import crypto from 'node:crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET;
const PADDLE_ENVIRONMENT = (process.env.PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production';

/** Boot-time defensive flag. If any required Paddle env var is missing the
 *  handlers stay disabled and return 503 — keeps the rest of the server
 *  alive instead of crashing the whole process at module load. */
const PADDLE_ENABLED =
  !!PADDLE_API_KEY &&
  !!PADDLE_WEBHOOK_SECRET &&
  !!process.env.PADDLE_PRICE_MONTHLY &&
  !!process.env.PADDLE_PRICE_YEARLY &&
  !!process.env.PADDLE_PRICE_LIFETIME;

if (!PADDLE_ENABLED) {
  console.warn('[paddle] env vars missing — paddle endpoints disabled. Set PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_PRICE_MONTHLY/YEARLY/LIFETIME.');
}

// Lazy-init Paddle SDK only when env vars are present. Avoids a hard crash
// on `new Paddle(undefined!, ...)` when the var is missing.
const paddle = PADDLE_ENABLED
  ? new Paddle(PADDLE_API_KEY!, {
      environment: PADDLE_ENVIRONMENT === 'sandbox' ? Environment.sandbox : Environment.production,
    })
  : (null as unknown as Paddle);

// Price ID → plan mapping (single product with 3 prices). Empty when
// PADDLE_ENABLED is false — no event will match anyway since we early-return.
const PRICE_PLAN_MAP: Record<string, { plan: 'premium' | 'lifetime'; interval?: string }> = PADDLE_ENABLED
  ? {
      [process.env.PADDLE_PRICE_MONTHLY!]: { plan: 'premium', interval: 'monthly' },
      [process.env.PADDLE_PRICE_YEARLY!]:  { plan: 'premium', interval: 'yearly' },
      [process.env.PADDLE_PRICE_LIFETIME!]: { plan: 'lifetime' },
    }
  : {};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

function logPaddle(actor: string | null, op: string, msg: string, kind: 'ok' | 'error' | 'processed' = 'ok'): void {
  const tag = kind === 'error' ? '[paddle][error]' : kind === 'processed' ? '[paddle][processed]' : '[paddle]';
  if (actor) console.log(`${tag} ${actor} ${op} ${msg}`);
  else console.log(`${tag} ${op} ${msg}`);
}

// ─── Webhook signature verification ──────────────────────────────────────────

function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature || !PADDLE_WEBHOOK_SECRET) return false;

  // Paddle Billing webhook signature format: ts=xxx;h1=xxx
  const parts = signature.split(';').reduce((acc, part) => {
    const [key, val] = part.split('=');
    acc[key] = val;
    return acc;
  }, {} as Record<string, string>);

  const ts = parts['ts'];
  const h1 = parts['h1'];
  if (!ts || !h1) return false;

  const payload = `${ts}:${rawBody}`;
  const expectedSig = crypto.createHmac('sha256', PADDLE_WEBHOOK_SECRET).update(payload).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(h1), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

// ─── Plan update logic ───────────────────────────────────────────────────────

async function updateUserPlan(
  customerId: string,
  subscriptionId: string,
  productId: string,
  status: string,
  nextBilledAt: string | null,
  canceledAt: string | null,
  customDataUserId?: string,
): Promise<void> {
  const mapping = PRICE_PLAN_MAP[productId];
  if (!mapping) {
    logPaddle(null, 'webhook', `unknown product ID: ${productId}`, 'error');
    return;
  }

  // Find user by paddle_customer_id in subscriptions table.
  let userId: string | undefined;

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('paddle_customer_id', customerId)
    .limit(1)
    .single();

  if (sub) {
    userId = sub.user_id;
  } else if (customDataUserId) {
    // Fallback: user paid with a different email, Paddle created a new
    // customer. Use the userId from custom_data and update the mapping.
    userId = customDataUserId;
    logPaddle(null, 'webhook', `customer ${customerId} not in DB, using custom_data.userId=${userId}`, 'ok');
    await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        paddle_customer_id: customerId,
        status: 'pending',
        plan: 'free',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  }

  if (!userId) {
    logPaddle(null, 'webhook', `no user found for customer: ${customerId}`, 'error');
    return;
  }

  // Update subscription record (upsert by user_id — one subscription per user).
  await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      paddle_customer_id: customerId,
      paddle_subscription_id: subscriptionId,
      paddle_price_id: productId,
      status,
      plan: mapping.plan,
      interval: mapping.interval || null,
      current_period_end: nextBilledAt,
      canceled_at: canceledAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  // Update user_settings based on subscription status.
  if (status === 'active' || status === 'trialing') {
    const planExpiry = mapping.plan === 'lifetime' ? null : nextBilledAt;

    await supabase
      .from('user_settings')
      .update({ plan: mapping.plan, plan_expiry: planExpiry, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    logPaddle(null, 'webhook', `${userId} → plan=${mapping.plan}, expiry=${planExpiry}`, 'processed');
  } else if (status === 'canceled' || status === 'past_due') {
    const expiresAt = nextBilledAt || canceledAt;
    const isExpired = expiresAt && new Date(expiresAt).getTime() <= Date.now();

    if (isExpired) {
      await supabase
        .from('user_settings')
        .update({ plan: 'free', plan_expiry: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      logPaddle(null, 'webhook', `${userId} → canceled immediately, set to free`, 'processed');
    } else if (expiresAt) {
      await supabase
        .from('user_settings')
        .update({ plan_expiry: expiresAt, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      logPaddle(null, 'webhook', `${userId} → canceled, active until ${expiresAt}`, 'processed');
    }
  }

  // Audit log.
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  await supabase.from('plan_activity_logs').insert({
    user_id: userId,
    user_email: userData?.user?.email || '',
    action_type: `paddle_${status}`,
    new_plan: status === 'canceled' ? 'free' : mapping.plan,
    old_plan: null,
    reason: `Paddle ${status} (${subscriptionId})`,
  });
}

// ─── Handle one-time purchase (lifetime) ─────────────────────────────────────

async function handleTransactionCompleted(event: any): Promise<void> {
  const transaction = event.data;
  const customerId = transaction.customer_id;
  const customDataUserId = transaction.custom_data?.userId;
  const items = transaction.items || [];

  for (const item of items) {
    const productId = item.price?.id;
    const mapping = PRICE_PLAN_MAP[productId];

    if (mapping?.plan === 'lifetime') {
      let userId: string | undefined;

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('paddle_customer_id', customerId)
        .limit(1)
        .single();

      if (sub) {
        userId = sub.user_id;
      } else if (customDataUserId) {
        userId = customDataUserId;
        logPaddle(null, 'webhook', `transaction: customer ${customerId} not in DB, using custom_data.userId=${userId}`, 'ok');
        await supabase.from('subscriptions').upsert(
          {
            user_id: userId,
            paddle_customer_id: customerId,
            status: 'pending',
            plan: 'free',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      }

      if (!userId) {
        logPaddle(null, 'webhook', `no user for customer ${customerId} on transaction`, 'error');
        return;
      }

      await supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          paddle_customer_id: customerId,
          paddle_subscription_id: transaction.id,
          paddle_price_id: productId,
          status: 'active',
          plan: 'lifetime',
          interval: null,
          current_period_end: null,
          canceled_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

      await supabase
        .from('user_settings')
        .update({ plan: 'lifetime', plan_expiry: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      logPaddle(null, 'webhook', `${userId} → lifetime (transaction ${transaction.id})`, 'processed');

      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      await supabase.from('plan_activity_logs').insert({
        user_id: userId,
        user_email: userData?.user?.email || '',
        action_type: 'paddle_lifetime_purchase',
        new_plan: 'lifetime',
        reason: `Paddle transaction ${transaction.id}`,
      });
    }
  }
}

async function storePaymentEvent(eventType: string, event: any): Promise<void> {
  await supabase.from('payment_events').insert({
    event_id: event.event_id,
    event_type: eventType,
    data: event.data,
  });
}

// ─── Webhook HTTP handler ────────────────────────────────────────────────────

export async function handlePaddleWebhook(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  // Read raw body — needed for HMAC signature verification (parsing first
  // would lose whitespace/key-order and break the signature match).
  const body = await c.req.text();
  const signature = c.req.header('paddle-signature');

  if (!verifyWebhookSignature(body, signature)) {
    logPaddle(null, 'webhook', 'invalid webhook signature', 'error');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const eventType = event.event_type as string;

  logPaddle(null, 'webhook', eventType, 'processed');

  try {
    await storePaymentEvent(eventType, event);

    switch (eventType) {
      case 'subscription.created':
      case 'subscription.updated': {
        const sub = event.data;
        const productId = sub.items?.[0]?.price?.id;
        const customDataUserId = sub.custom_data?.userId;
        const scheduledCancel = sub.scheduled_change?.action === 'cancel';
        const effectiveStatus = scheduledCancel ? 'canceled' : sub.status;
        const effectiveExpiry = scheduledCancel ? sub.scheduled_change.effective_at : sub.next_billed_at;
        await updateUserPlan(
          sub.customer_id,
          sub.id,
          productId,
          effectiveStatus,
          effectiveExpiry || null,
          sub.canceled_at || (scheduledCancel ? new Date().toISOString() : null),
          customDataUserId,
        );
        break;
      }
      case 'subscription.canceled': {
        const sub = event.data;
        const productId = sub.items?.[0]?.price?.id;
        const customDataUserId = sub.custom_data?.userId;
        await updateUserPlan(
          sub.customer_id,
          sub.id,
          productId,
          'canceled',
          sub.next_billed_at || null,
          sub.canceled_at || new Date().toISOString(),
          customDataUserId,
        );
        break;
      }
      case 'transaction.completed': {
        await handleTransactionCompleted(event);
        break;
      }
      default:
        logPaddle(null, 'webhook', `unhandled event: ${eventType}`, 'ok');
    }

    return c.json({ ok: true });
  } catch (err) {
    logPaddle(null, 'webhook', String(err), 'error');
    return c.json({ error: 'Internal error' }, 500);
  }
}

// ─── Billing-link endpoint ───────────────────────────────────────────────────
// POST /api/paddle/billing-link — ensures Paddle customer exists + returns a
// signed token. Used by the extension's Upgrade / Manage button to open
// chessr.io/checkout without needing the extension billing page.

const BILLING_TOKEN_SECRET = PADDLE_WEBHOOK_SECRET;
const BILLING_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function signBillingToken(userId: string, customerId: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}:${customerId}:${ts}`;
  const sig = crypto.createHmac('sha256', BILLING_TOKEN_SECRET!).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyBillingToken(token: string): { userId: string; customerId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;
    const [userId, customerId, ts, sig] = parts;
    if (Date.now() - Number(ts) > BILLING_TOKEN_TTL) return null;
    const payload = `${userId}:${customerId}:${ts}`;
    const expected = crypto.createHmac('sha256', BILLING_TOKEN_SECRET!).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { userId, customerId };
  } catch {
    return null;
  }
}

export async function handlePaddleBillingLink(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const authHeader = c.req.header('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: 'Authentication required' }, 401);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return c.json({ error: 'Invalid token' }, 401);

  const userId = authData.user.id;
  const userEmail = authData.user.email || '';

  let customerId: string | undefined;

  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('paddle_customer_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (existingSub?.paddle_customer_id) {
    try {
      await paddle.customers.get(existingSub.paddle_customer_id);
      customerId = existingSub.paddle_customer_id;
    } catch {
      // Stale customer ID — clear it and create fresh below.
      await supabase.from('subscriptions').delete().eq('user_id', userId);
    }
  }

  if (!customerId) {
    try {
      const customer = await paddle.customers.create({ email: userEmail });
      customerId = customer.id;
    } catch (createErr: any) {
      if (createErr?.code === 'conflict' || createErr?.type === 'request_error') {
        const customers = await paddle.customers.list({ email: [userEmail] });
        for await (const cust of customers) {
          customerId = cust.id;
          break;
        }
      }
      if (!customerId) {
        logPaddle(userEmail, 'billing-link', String(createErr), 'error');
        return c.json({ error: 'Failed to create Paddle customer' }, 500);
      }
    }

    await supabase.from('subscriptions').upsert(
      {
        user_id: userId,
        paddle_customer_id: customerId,
        status: 'pending',
        plan: 'free',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  }

  const billingToken = signBillingToken(userId, customerId);
  logPaddle(userEmail, 'billing-link', `customer=${customerId}`, 'ok');
  return c.json({ token: billingToken });
}
