/**
 * Paddle billing handlers (Hono).
 *
 * Ported from chessr-next/serveur/src/handlers/paddleHandler.ts (raw Node
 * http) — same protocol, same Supabase tables, same Paddle SDK usage,
 * same request/response shapes. The DNS-flip migration plan: when this
 * v3 server takes over from v2, we just point engine.chessr.io's
 * A-record at the v3 IP. Paddle's webhook endpoint URL doesn't change,
 * dashboard stays untouched.
 *
 * Endpoints:
 *   - POST /api/paddle/webhook                  — Paddle → us, signed events
 *   - POST /api/paddle/billing-link             — auth → returns a signed token
 *   - POST /api/paddle/checkout                 — auth, body: { plan }
 *   - POST /api/paddle/checkout-by-token        — token, body: { token, plan }
 *   - GET  /api/paddle/subscription             — auth, returns subscription row
 *   - POST /api/paddle/status-by-token          — token, plan + sub summary
 *   - POST /api/paddle/switch                   — auth, monthly ↔ yearly
 *   - POST /api/paddle/switch-by-token          — token version
 *   - POST /api/paddle/cancel                   — auth, end-of-period
 *   - POST /api/paddle/cancel-by-token          — token version
 *   - POST /api/paddle/preview-upgrade          — auth, prorate calc
 *   - POST /api/paddle/preview-upgrade-by-token — token version
 *   - POST /api/paddle/upgrade-lifetime         — auth, cancel + lifetime checkout
 *   - POST /api/paddle/upgrade-lifetime-by-token — token version
 *   - GET  /api/paddle/prices                   — public, localized pricing
 */

import type { Context } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import crypto from 'node:crypto';
import { emitEvent } from '../lib/events.js';

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

// Price ID → plan mapping. Premium product has 3 prices (monthly / yearly
// / lifetime). The standalone Unlocker product (chess.com Review Unlocker
// extension) has 2 prices (monthly / yearly). Unlocker env vars are
// OPTIONAL — falsy when omitted so the map only includes keys we have
// price IDs for. Empty when PADDLE_ENABLED is false (no event will match).
const PRICE_PLAN_MAP: Record<string, { plan: 'premium' | 'lifetime' | 'unlocker'; interval?: string }> = PADDLE_ENABLED
  ? {
      [process.env.PADDLE_PRICE_MONTHLY!]: { plan: 'premium', interval: 'monthly' },
      [process.env.PADDLE_PRICE_YEARLY!]:  { plan: 'premium', interval: 'yearly' },
      [process.env.PADDLE_PRICE_LIFETIME!]: { plan: 'lifetime' },
      ...(process.env.PADDLE_PRICE_UNLOCKER_MONTHLY
        ? { [process.env.PADDLE_PRICE_UNLOCKER_MONTHLY]: { plan: 'unlocker' as const, interval: 'monthly' } }
        : {}),
      ...(process.env.PADDLE_PRICE_UNLOCKER_YEARLY
        ? { [process.env.PADDLE_PRICE_UNLOCKER_YEARLY]: { plan: 'unlocker' as const, interval: 'yearly' } }
        : {}),
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

  // Snapshot the previous plan/expiry before mutating so we can emit a
  // proper `plan_changed` event downstream — the bot uses oldPlan/newPlan
  // to decide whether to swap the Discord role.
  const { data: prevSettings } = await supabase
    .from('user_settings')
    .select('plan, plan_expiry')
    .eq('user_id', userId)
    .single();
  const oldPlan = prevSettings?.plan ?? null;
  const oldExpiry = prevSettings?.plan_expiry ?? null;

  // Previous subscription status — used to detect cancel / past_due
  // transitions vs duplicate webhooks on already-canceled subs.
  const { data: prevSubRow } = await supabase
    .from('subscriptions')
    .select('status, paddle_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();
  const oldStatus: string | null = prevSubRow?.status ?? null;

  // Stale-event guard. Paddle keeps emitting events for a user's OLD
  // subscription after they've moved to a new one — e.g. the final
  // subscription.canceled when a past_due sub exhausts its payment
  // retries a month later, while the user already re-subscribed. The
  // row is keyed by user_id (one sub per user), so processing that
  // event would clobber the new active sub and revoke a paid plan.
  // Only negative transitions are ignored: an incoming active sub with
  // a new id is precisely how the row migrates to a re-subscription.
  if (
    (status === 'canceled' || status === 'past_due') &&
    prevSubRow?.paddle_subscription_id &&
    prevSubRow.paddle_subscription_id !== subscriptionId
  ) {
    logPaddle(
      null,
      'webhook',
      `ignoring stale ${status} for ${subscriptionId} — ${userId} is now on ${prevSubRow.paddle_subscription_id}`,
      'processed',
    );
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

  // Compute the post-mutation plan/expiry mirror so the emit can describe
  // exactly what landed in user_settings.
  let newPlan: string = oldPlan ?? 'free';
  let newExpiry: string | null = oldExpiry;

  // Update user_settings based on subscription status.
  if (status === 'active' || status === 'trialing') {
    const planExpiry = mapping.plan === 'lifetime' ? null : nextBilledAt;

    await supabase
      .from('user_settings')
      .update({ plan: mapping.plan, plan_expiry: planExpiry, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    newPlan = mapping.plan;
    newExpiry = planExpiry;
    logPaddle(null, 'webhook', `${userId} → plan=${mapping.plan}, expiry=${planExpiry}`, 'processed');
  } else if (status === 'past_due') {
    // Cancel immediately on first payment failure — don't honor the access-until
    // date. If Paddle retries successfully, the next subscription.updated with
    // status='active' will restore the plan automatically.
    await supabase
      .from('user_settings')
      .update({ plan: 'free', plan_expiry: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    newPlan = 'free';
    newExpiry = null;
    logPaddle(null, 'webhook', `${userId} → past_due, cancelled immediately`, 'processed');
  } else if (status === 'canceled') {
    const expiresAt = nextBilledAt || canceledAt;
    const isExpired = expiresAt && new Date(expiresAt).getTime() <= Date.now();

    if (isExpired) {
      await supabase
        .from('user_settings')
        .update({ plan: 'free', plan_expiry: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      newPlan = 'free';
      newExpiry = null;
      logPaddle(null, 'webhook', `${userId} → canceled immediately, set to free`, 'processed');
    } else if (expiresAt) {
      await supabase
        .from('user_settings')
        .update({ plan_expiry: expiresAt, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      newExpiry = expiresAt;
      logPaddle(null, 'webhook', `${userId} → canceled, active until ${expiresAt}`, 'processed');
    }
  }

  // Drive the bot's role sync + activity feed via the events bus. The
  // emitted event also serves as the audit trail (formerly written to
  // Supabase's plan_activity_logs — now superseded by the local-pg
  // events table). Skip the emit if nothing observably changed (rare —
  // webhook replay with unchanged plan + expiry).
  if (oldPlan !== newPlan || oldExpiry !== newExpiry) {
    await emitEvent({
      type: 'plan_changed',
      user_id: userId,
      payload: {
        oldPlan,
        newPlan,
        oldExpiry,
        newExpiry,
        reason: `paddle_${status}`,
      },
    });

    // ─── Customer lifecycle: new vs renewal ─────────────────────────────
    // Emitted IN ADDITION to plan_changed for cleaner mod-channel
    // routing. Both events fire on the same webhook so the bot picks
    // whichever it has a handler for.
    const FREE_TIERS = new Set(['free', 'freetrial', null, undefined]);
    const PAID_TIERS = new Set(['premium', 'lifetime', 'unlocker']);
    const isNewCustomer = FREE_TIERS.has(oldPlan as string | null) && PAID_TIERS.has(newPlan);
    const isRenewal =
      oldPlan === newPlan &&
      PAID_TIERS.has(newPlan) &&
      newPlan !== 'lifetime' &&  // lifetime has no expiry to push
      oldExpiry && newExpiry &&
      new Date(newExpiry).getTime() > new Date(oldExpiry).getTime();

    if (isNewCustomer) {
      await emitEvent({
        type: 'new_customer',
        user_id: userId,
        payload: {
          plan: newPlan,
          newExpiry,
          subscriptionId,
          interval: mapping.interval || null,
          productId,
        },
      });
    } else if (isRenewal) {
      await emitEvent({
        type: 'customer_renewed',
        user_id: userId,
        payload: {
          plan: newPlan,
          oldExpiry,
          newExpiry,
          subscriptionId,
          interval: mapping.interval || null,
          productId,
        },
      });
    }
  }

  // ─── Cancel / payment_failed signals ─────────────────────────────────
  // Independent of the plan_changed gate above: a renewal failure can
  // leave the plan unchanged (user still has access until expiry) but
  // mods need to know NOW so they can reach out. Same for a scheduled
  // cancel.
  //
  // We only emit on a *transition* (not on duplicate webhooks where the
  // sub was already canceled/past_due), comparing the row's previous
  // status to the incoming one.
  if (status === 'past_due' && oldStatus !== 'past_due') {
    await emitEvent({
      type: 'payment_failed',
      user_id: userId,
      payload: {
        plan: mapping.plan,
        expiresAt: nextBilledAt || canceledAt || null,
        subscriptionId,
        productId,
      },
    });
  }
  if (status === 'canceled' && oldStatus !== 'canceled') {
    await emitEvent({
      type: 'customer_canceled',
      user_id: userId,
      payload: {
        plan: mapping.plan,
        expiresAt: nextBilledAt || canceledAt || null,
        subscriptionId,
        productId,
        // True when the user clicked cancel and the sub is still
        // running until effective_at; false when Paddle confirmed the
        // cancel is immediate (no future bill).
        scheduled: !!nextBilledAt && new Date(nextBilledAt).getTime() > Date.now(),
      },
    });
  }
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

      // Snapshot prior plan/expiry for the plan_changed event below.
      const { data: prevSettings } = await supabase
        .from('user_settings')
        .select('plan, plan_expiry')
        .eq('user_id', userId)
        .single();
      const oldPlan = prevSettings?.plan ?? null;
      const oldExpiry = prevSettings?.plan_expiry ?? null;

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

      // Bot needs to swap the Lifetime role; activity feed needs the
      // entry; the emitted event is the audit trail (Supabase's
      // plan_activity_logs is retired in v3). Skip if it's a duplicate
      // webhook delivery on an already-lifetime account.
      if (oldPlan !== 'lifetime') {
        await emitEvent({
          type: 'plan_changed',
          user_id: userId,
          payload: {
            oldPlan,
            newPlan: 'lifetime',
            oldExpiry,
            newExpiry: null,
            reason: 'paddle_lifetime_purchase',
          },
        });

        // First-time lifetime buyers AND existing premiums upgrading to
        // lifetime are both "new customers" for billing purposes — the
        // alternative is no event at all on a premium → lifetime upgrade,
        // which the mod channel cares about.
        await emitEvent({
          type: 'new_customer',
          user_id: userId,
          payload: {
            plan: 'lifetime',
            newExpiry: null,
            subscriptionId: transaction.id,
            interval: null,
            productId,
            previousPlan: oldPlan,
          },
        });
      }
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

// ─── Helpers shared by the rest of the endpoints ─────────────────────────────

/** First IP we recorded for this user at signup — used to pin Paddle's
 *  pricing localisation to the country the user signed up from rather
 *  than letting it follow VPN / travel. Falls back to null silently. */
async function getSignupIp(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('signup_ips')
      .select('ip_address')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    return data?.ip_address || null;
  } catch {
    return null;
  }
}

/** Builds the `customerIpAddress` param for Paddle pricingPreview. Prefers
 *  the user's signup IP, falls back to the current request IP, drops
 *  loopback addresses (Paddle returns "invalid IP" on those). */
function buildLocationParam(
  signupIp: string | null,
  clientIp: string | undefined,
): Record<string, unknown> {
  const ip = signupIp || clientIp;
  if (ip && !ip.startsWith('127.') && !ip.startsWith('::1')) {
    return { customerIpAddress: ip };
  }
  return {};
}

function getClientIpFromCtx(c: Context): string | undefined {
  const xff = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip');
  if (!xff) return undefined;
  return xff.split(',')[0]?.trim() || undefined;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', INR: '₹', JPY: '¥', CNY: '¥',
  KRW: '₩', BRL: 'R$', MXN: '$', AUD: 'A$', CAD: 'C$', CHF: 'CHF ',
  SEK: 'kr ', NOK: 'kr ', DKK: 'kr ', PLN: 'zł', CZK: 'Kč ',
  HUF: 'Ft ', TRY: '₺', ZAR: 'R ', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$',
  THB: '฿', TWD: 'NT$', ARS: 'ARS ', COP: 'COP ', IDR: 'Rp ',
  MYR: 'RM ', PHP: '₱', VND: '₫', UAH: '₴', ILS: '₪', EGP: 'E£',
  NGN: '₦', KES: 'KSh ', GHS: 'GH₵', PKR: 'Rs ', BDT: '৳',
};
function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code + ' ';
}
function formatAmount(amount: number, currencyCode: string): string {
  const sym = currencySymbol(currencyCode);
  return `${sym}${(Math.abs(amount) / 100).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Auth-bearer flow: read the Authorization header, resolve the Supabase
 *  user. On any failure return a 401 Response so the caller can early-exit
 *  with `if (response) return response;`. Same convention used for the
 *  billing-token flow below. */
async function requireBearerUser(
  c: Context,
): Promise<{ userId: string; email: string } | Response> {
  const authHeader = c.req.header('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: 'Authentication required' }, 401);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'Invalid token' }, 401);
  return { userId: data.user.id, email: data.user.email || '' };
}

const PADDLE_PRICES: Record<string, string | undefined> = {
  monthly: process.env.PADDLE_PRICE_MONTHLY,
  yearly:  process.env.PADDLE_PRICE_YEARLY,
  lifetime: process.env.PADDLE_PRICE_LIFETIME,
  // Unlocker product — €1/mo, €10/yr. Optional: when env vars are
  // missing, /api/paddle/checkout returns 400 'Invalid plan' for these
  // keys, just like any other unmapped plan.
  unlocker_monthly: process.env.PADDLE_PRICE_UNLOCKER_MONTHLY,
  unlocker_yearly:  process.env.PADDLE_PRICE_UNLOCKER_YEARLY,
};

// ─── POST /api/paddle/checkout ──────────────────────────────────────────────
// Body: { plan: 'monthly' | 'yearly' | 'lifetime' }
// Returns: { transactionId } — used by the front to open a Paddle checkout.
export async function handlePaddleCheckout(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const auth = await requireBearerUser(c);
  if (auth instanceof Response) return auth;
  const { userId, email: userEmail } = auth;

  let body: { plan?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const plan = body.plan || '';
  const priceId = PADDLE_PRICES[plan];
  if (!priceId) return c.json({ error: 'Invalid plan. Use: monthly, yearly, lifetime, unlocker_monthly, or unlocker_yearly' }, 400);

  logPaddle(userEmail, 'checkout', `user=${userId}, plan=${plan}, priceId=${priceId}`, 'ok');

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
      logPaddle(userEmail, 'checkout', `reusing customer: ${customerId}`, 'ok');
    } catch {
      logPaddle(userEmail, 'checkout', `customer ${existingSub.paddle_customer_id} stale, recreating`, 'ok');
      await supabase.from('subscriptions').delete().eq('user_id', userId);
    }
  }

  if (!customerId) {
    try {
      const customer = await paddle.customers.create({ email: userEmail });
      customerId = customer.id;
      logPaddle(userEmail, 'customer-created', `customer=${customerId}`, 'ok');
    } catch (createErr: any) {
      if (createErr?.code === 'conflict' || createErr?.type === 'request_error') {
        const customers = await paddle.customers.list({ email: [userEmail] });
        for await (const cust of customers) {
          customerId = cust.id;
          logPaddle(userEmail, 'checkout', `found existing customer: ${customerId}`, 'ok');
          break;
        }
      }
      if (!customerId) {
        logPaddle(userEmail, 'checkout', String(createErr), 'error');
        return c.json({ error: 'Internal error' }, 500);
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

  try {
    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customerId,
      customData: { userId },
    });
    logPaddle(userEmail, 'checkout', `plan=${plan}, txn=${transaction.id}`, 'processed');
    return c.json({ transactionId: transaction.id });
  } catch (err) {
    logPaddle(userEmail, 'checkout', String(err), 'error');
    return c.json({ error: 'Internal error' }, 500);
  }
}

// ─── POST /api/paddle/checkout-by-token ─────────────────────────────────────
// Body: { token, plan }
export async function handlePaddleCheckoutByToken(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  let body: { token?: string; plan?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);

  const priceId = PADDLE_PRICES[body.plan || ''];
  if (!priceId) return c.json({ error: 'Invalid plan. Use: monthly, yearly, lifetime, unlocker_monthly, or unlocker_yearly' }, 400);

  const { userId, customerId } = verified;
  try {
    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customerId,
      customData: { userId },
    });
    logPaddle(null, 'checkout', `user=${userId}, plan=${body.plan}, txn=${transaction.id}`, 'processed');
    return c.json({ transactionId: transaction.id });
  } catch (err) {
    logPaddle(null, 'checkout', String(err), 'error');
    return c.json({ error: 'Internal error' }, 500);
  }
}

// ─── GET /api/paddle/subscription ───────────────────────────────────────────
// Auth-bearer. Returns the entire row (`{ subscription }`) — front uses this
// for the Manage Plan view.
export async function handlePaddleSubscriptionStatus(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const auth = await requireBearerUser(c);
  if (auth instanceof Response) return auth;

  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', auth.userId)
      .limit(1)
      .single();
    return c.json({ subscription: sub || null });
  } catch (err) {
    logPaddle(null, 'status', String(err), 'error');
    return c.json({ error: 'Internal error' }, 500);
  }
}

// ─── POST /api/paddle/status-by-token ───────────────────────────────────────
// Body: { token } → returns { plan, planExpiry, freetrialUsed, discordLinked,
// subscription: { interval, currentPeriodEnd, status, canceledAt, hasSubscription } }
export async function handleStatusByToken(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  let body: { token?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);

  const { userId } = verified;
  try {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('plan, plan_expiry, freetrial_used, discord_id')
      .eq('user_id', userId)
      .single();

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('interval, current_period_end, status, canceled_at, paddle_subscription_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    return c.json({
      plan: settings?.plan || 'free',
      planExpiry: settings?.plan_expiry || null,
      freetrialUsed: settings?.freetrial_used ?? true,
      discordLinked: !!settings?.discord_id,
      subscription: sub
        ? {
            interval: sub.interval || null,
            currentPeriodEnd: sub.current_period_end || null,
            status: sub.status || null,
            canceledAt: sub.canceled_at || null,
            hasSubscription: !!sub.paddle_subscription_id,
          }
        : null,
    });
  } catch (err) {
    logPaddle(null, 'status', String(err), 'error');
    return c.json({ error: 'Internal error' }, 500);
  }
}

// ─── Switch (auth + token) ──────────────────────────────────────────────────
// Both flows share the same body { plan } / { token, plan } and same
// response { ok: true, nextBilledAt }.
async function switchSubscription(c: Context, userId: string, plan: string): Promise<Response> {
  const priceId = PADDLE_PRICES[plan];
  if (!priceId) return c.json({ error: 'Invalid plan. Use: monthly or yearly' }, 400);

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (!sub?.paddle_subscription_id) return c.json({ error: 'No active subscription found' }, 400);

  try {
    const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;
    const updated = await paddle.subscriptions.update(sub.paddle_subscription_id, {
      items: [{ priceId, quantity: 1 }],
      prorationBillingMode: 'prorated_immediately',
      ...(discountId ? { discount: { id: discountId, effectiveFrom: 'immediately' } } : {}),
    });
    logPaddle(null, 'switch', `plan=${plan}, user=${userId}, sub=${sub.paddle_subscription_id}`, 'processed');
    return c.json({ ok: true, nextBilledAt: updated.nextBilledAt });
  } catch (err) {
    logPaddle(null, 'switch', String(err), 'error');
    return c.json({ error: 'Failed to switch plan' }, 500);
  }
}

export async function handlePaddleSwitch(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const auth = await requireBearerUser(c);
  if (auth instanceof Response) return auth;
  let body: { plan?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  return switchSubscription(c, auth.userId, body.plan || '');
}

export async function handleSwitchByToken(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  let body: { token?: string; plan?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);
  return switchSubscription(c, verified.userId, body.plan || '');
}

// ─── Cancel (auth + token) ──────────────────────────────────────────────────
// Cancels at end of billing period. Stores the survey reason if provided.
// Body: { reason?: string, details?: string } — same for both flows.
async function cancelSubscription(
  c: Context,
  userId: string,
  reason: string | undefined,
  details: string | undefined,
): Promise<Response> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id, plan, interval')
    .eq('user_id', userId)
    .limit(1)
    .single();
  if (!sub?.paddle_subscription_id) return c.json({ error: 'No active subscription found' }, 400);

  try {
    await paddle.subscriptions.cancel(sub.paddle_subscription_id, {
      effectiveFrom: 'next_billing_period',
    });
    logPaddle(null, 'cancel', `user=${userId}, sub=${sub.paddle_subscription_id}, reason=${reason || 'none'}`, 'processed');

    if (reason) {
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      await supabase.from('cancel_reasons').insert({
        user_id: userId,
        user_email: userData?.user?.email || '',
        reason,
        details: details || null,
        plan: sub.plan,
        interval: sub.interval,
      });
    }
    return c.json({ ok: true });
  } catch (err) {
    logPaddle(null, 'cancel', String(err), 'error');
    return c.json({ error: 'Failed to cancel subscription' }, 500);
  }
}

export async function handlePaddleCancel(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const auth = await requireBearerUser(c);
  if (auth instanceof Response) return auth;
  let body: { reason?: string; details?: string };
  try { body = await c.req.json(); } catch { body = {}; }
  return cancelSubscription(c, auth.userId, body.reason, body.details);
}

export async function handleCancelByToken(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  let body: { token?: string; reason?: string; details?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);
  return cancelSubscription(c, verified.userId, body.reason, body.details);
}

// ─── Preview upgrade (auth + token) ─────────────────────────────────────────
// Body: { plan: 'yearly' | 'lifetime', currency? }
// Returns: { planLabel, planPrice, discount, prorate, total, nextBilledAt }
async function previewUpgrade(
  c: Context,
  userId: string,
  plan: string,
  requestedCurrency: string | undefined,
): Promise<Response> {
  const targetPriceId = PADDLE_PRICES[plan];
  // Allowed upgrade targets: Premium monthly/yearly + Lifetime. Monthly is
  // a valid target for `unlocker → premium-monthly` (smaller jump than to
  // yearly). 'unlocker_*' is NOT a target here — that's a same-plan
  // billing-cycle switch and goes through switchSubscription directly.
  if (!targetPriceId || (plan !== 'monthly' && plan !== 'yearly' && plan !== 'lifetime')) {
    return c.json({ error: 'Invalid plan. Use: monthly, yearly or lifetime' }, 400);
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id, interval')
    .eq('user_id', userId)
    .limit(1)
    .single();
  if (!sub?.paddle_subscription_id) return c.json({ error: 'No active subscription' }, 400);

  try {
    const clientIp = getClientIpFromCtx(c);
    const signupIp = await getSignupIp(userId);
    const locationParam = buildLocationParam(signupIp, clientIp);
    const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;
    // SDK 3.x types currencyCode as a CurrencyCode enum, but the front
    // forwards arbitrary strings. Cast through any — Paddle validates
    // server-side and returns a clear error for unknown codes.
    const currencyParam = requestedCurrency ? ({ currencyCode: requestedCurrency } as any) : {};

    const targetPreview = await paddle.pricingPreview.preview({
      items: [{ priceId: targetPriceId, quantity: 1 }],
      ...locationParam,
      ...currencyParam,
      ...(discountId ? { discountId } : {}),
    });

    const targetLine = (targetPreview as any).details?.lineItems?.[0];
    const targetTotals = targetLine?.totals;
    const currencyCode = (targetPreview as any).currencyCode || 'USD';
    const fmt = (amount: number) => formatAmount(amount, currencyCode);

    const targetTotal = Number(targetTotals?.total || 0);
    const targetDiscount = Number(targetTotals?.discount || 0);
    const targetOriginal = targetTotal + targetDiscount;

    const subscription = await paddle.subscriptions.get(sub.paddle_subscription_id);
    const currentItem = subscription.items?.[0];
    const billingStart = subscription.currentBillingPeriod?.startsAt;
    const billingEnd = subscription.currentBillingPeriod?.endsAt;

    let localizedSubPrice = 0;
    if (currentItem?.price?.id) {
      const subPreview = await paddle.pricingPreview.preview({
        items: [{ priceId: currentItem.price.id, quantity: 1 }],
        ...locationParam,
        ...currencyParam,
      });
      const subLine = (subPreview as any).details?.lineItems?.[0];
      localizedSubPrice = Number(subLine?.totals?.total || 0);
    }

    let prorate = 0;
    if (billingStart && billingEnd && localizedSubPrice > 0) {
      const start = new Date(billingStart).getTime();
      const end = new Date(billingEnd).getTime();
      const now = Date.now();
      const totalDays = (end - start) / (1000 * 60 * 60 * 24);
      const remainingDays = Math.max(0, (end - now) / (1000 * 60 * 60 * 24));
      prorate = Math.round((remainingDays / totalDays) * localizedSubPrice);
    }

    const finalTotal = Math.max(0, targetTotal - prorate);

    let nextBilledAt: string | null = null;
    if (plan === 'yearly') {
      nextBilledAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    } else if (plan === 'monthly') {
      nextBilledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    const planLabel =
      plan === 'yearly' ? 'Premium Yearly'
      : plan === 'monthly' ? 'Premium Monthly'
      : 'Lifetime';

    return c.json({
      planLabel,
      planPrice: fmt(targetOriginal),
      discount: targetDiscount > 0 ? fmt(targetDiscount) : null,
      prorate: prorate > 0 ? fmt(prorate) : null,
      total: fmt(finalTotal),
      nextBilledAt,
    });
  } catch (err) {
    logPaddle(null, 'preview-upgrade', String(err), 'error');
    return c.json({ error: 'Failed to preview upgrade' }, 500);
  }
}

export async function handlePaddlePreviewUpgrade(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const auth = await requireBearerUser(c);
  if (auth instanceof Response) return auth;
  let body: { plan?: string; currency?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  return previewUpgrade(c, auth.userId, body.plan || '', body.currency);
}

export async function handlePreviewUpgradeByToken(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  let body: { token?: string; plan?: string; currency?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);
  return previewUpgrade(c, verified.userId, body.plan || '', body.currency);
}

// ─── Upgrade lifetime (auth + token) ────────────────────────────────────────
// Cancels current sub immediately, then opens a lifetime checkout.
// Returns: { transactionId } — same as /checkout.
async function upgradeLifetime(
  c: Context,
  userId: string,
  fallbackCustomerId: string | undefined,
): Promise<Response> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id, paddle_customer_id')
    .eq('user_id', userId)
    .limit(1)
    .single();
  if (!sub?.paddle_subscription_id) return c.json({ error: 'No active subscription' }, 400);

  try {
    await paddle.subscriptions.cancel(sub.paddle_subscription_id, { effectiveFrom: 'immediately' });
    logPaddle(null, 'lifetime-upgrade', `canceled sub ${sub.paddle_subscription_id}`, 'processed');

    const priceId = PADDLE_PRICES['lifetime'];
    if (!priceId) return c.json({ error: 'Lifetime price not configured' }, 500);

    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customerId: sub.paddle_customer_id || fallbackCustomerId!,
      customData: { userId },
    });
    logPaddle(null, 'lifetime-upgrade', `user=${userId}, txn=${transaction.id}`, 'processed');
    return c.json({ transactionId: transaction.id });
  } catch (err) {
    logPaddle(null, 'lifetime-upgrade', String(err), 'error');
    return c.json({ error: 'Failed to upgrade to lifetime' }, 500);
  }
}

export async function handlePaddleUpgradeLifetime(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  const auth = await requireBearerUser(c);
  if (auth instanceof Response) return auth;
  return upgradeLifetime(c, auth.userId, undefined);
}

export async function handleUpgradeLifetimeByToken(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  let body: { token?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);
  return upgradeLifetime(c, verified.userId, verified.customerId);
}

// ─── POST /admin/paddle/extend ──────────────────────────────────────────────
// Admin-token-protected. Adds N days to a user's Paddle subscription by
// pushing `nextBilledAt` forward without re-billing. Strict guards:
//   - plan must be premium / freetrial / beta (not free, not lifetime)
//   - subscriptions.paddle_subscription_id must be set
//   - subscription must not be canceled or scheduled-to-cancel
// Non-Paddle plans (gifted via dashboard / freetrial) keep using the
// existing PATCH on user_settings.plan_expiry — they don't reach here.
//
// Body: { userId, days, reason? }
// Response: { ok: true, nextBilledAt } on success, { error } otherwise.
export async function handleExtendPaddleSubscription(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);

  const adminToken = c.req.header('x-admin-token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || adminToken !== expected) return c.json({ error: 'Forbidden' }, 403);

  let body: { userId?: string; days?: number; reason?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const userId = typeof body.userId === 'string' ? body.userId : '';
  const days = typeof body.days === 'number' && Number.isFinite(body.days) ? Math.floor(body.days) : 0;
  if (!userId) return c.json({ error: 'userId required' }, 400);
  if (days <= 0) return c.json({ error: 'days must be a positive integer' }, 400);
  if (days > 365) return c.json({ error: 'days must be ≤ 365' }, 400);

  // Plan eligibility — explicit blocks for free / lifetime so the admin
  // gets a clear message rather than a confusing Paddle error.
  const { data: settings } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();
  const plan = settings?.plan ?? 'free';
  if (plan === 'free') return c.json({ error: 'Cannot extend a free plan' }, 400);
  if (plan === 'lifetime') return c.json({ error: 'Cannot extend a lifetime plan' }, 400);

  // Subscription row must exist + not be canceled. The DB mirror is
  // updated by the webhook so any cancel / scheduled cancel surfaces here.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('paddle_subscription_id, status, canceled_at')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (!sub?.paddle_subscription_id) {
    return c.json({ error: 'User does not have a Paddle subscription' }, 400);
  }
  if (sub.status === 'canceled' || sub.canceled_at) {
    return c.json({ error: 'Cannot extend a cancelled subscription' }, 400);
  }

  try {
    // Fetch live subscription from Paddle — DB mirror could be stale on
    // brand-new subs that haven't been synced yet.
    const subscription = await paddle.subscriptions.get(sub.paddle_subscription_id);
    if (subscription.status === 'canceled' || subscription.scheduledChange?.action === 'cancel') {
      return c.json({ error: 'Cannot extend a cancelled subscription' }, 400);
    }

    const baseIso = subscription.nextBilledAt || subscription.currentBillingPeriod?.endsAt;
    if (!baseIso) return c.json({ error: 'Subscription has no billing period' }, 400);

    const newDate = new Date(new Date(baseIso).getTime() + days * 24 * 60 * 60 * 1000);
    const newIso = newDate.toISOString();

    // do_not_bill: push the date without generating an invoice. Paddle
    // applies the new date to the current period; webhook fires
    // `subscription.updated` so user_settings.plan_expiry gets mirrored
    // through our existing handler — no double-write needed here.
    await paddle.subscriptions.update(sub.paddle_subscription_id, {
      nextBilledAt: newIso,
      prorationBillingMode: 'do_not_bill',
    });

    logPaddle(
      null,
      'extend',
      `user=${userId}, sub=${sub.paddle_subscription_id}, days=+${days}, newDate=${newIso}, reason=${body.reason || 'none'}`,
      'processed',
    );

    return c.json({ ok: true, nextBilledAt: newIso });
  } catch (err) {
    logPaddle(null, 'extend', String(err), 'error');
    return c.json({ error: 'Failed to extend subscription' }, 500);
  }
}

// ─── GET /api/paddle/prices ─────────────────────────────────────────────────
// Public. Optional ?userId= to localise via signup IP. Returns
// { monthly: {...}, yearly: {...}, lifetime: {...} }.
export async function handlePaddlePrices(c: Context): Promise<Response> {
  if (!PADDLE_ENABLED) return c.json({ error: 'Paddle not configured' }, 503);
  try {
    const clientIp = getClientIpFromCtx(c);
    const userId = c.req.query('userId');
    const signupIp = userId ? await getSignupIp(userId) : null;
    const locationParam = buildLocationParam(signupIp, clientIp);
    const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;

    const monthly = PADDLE_PRICES['monthly']!;
    const yearly = PADDLE_PRICES['yearly']!;
    const lifetime = PADDLE_PRICES['lifetime']!;
    const unlockerMonthly = PADDLE_PRICES['unlocker_monthly'];
    const unlockerYearly  = PADDLE_PRICES['unlocker_yearly'];

    logPaddle(null, 'prices', `userId=${userId || 'none'}, signupIp=${signupIp || 'none'}`, 'ok');

    // Build the item list dynamically: unlocker prices are optional, only
    // include them in the preview when the env vars are set so older deploys
    // without the unlocker product keep working.
    const items: { priceId: string; quantity: number }[] = [
      { priceId: monthly,  quantity: 1 },
      { priceId: yearly,   quantity: 1 },
      { priceId: lifetime, quantity: 1 },
    ];
    if (unlockerMonthly) items.push({ priceId: unlockerMonthly, quantity: 1 });
    if (unlockerYearly)  items.push({ priceId: unlockerYearly,  quantity: 1 });

    const preview = await paddle.pricingPreview.preview({
      items,
      ...locationParam,
      ...(discountId ? { discountId } : {}),
    });

    const prices: Record<string, { price: string; original: string | null; currency: string }> = {};

    for (const item of (preview as any).details?.lineItems || []) {
      const priceId = item.price?.id;
      let planKey: string | null = null;
      if (priceId === monthly) planKey = 'monthly';
      else if (priceId === yearly) planKey = 'yearly';
      else if (priceId === lifetime) planKey = 'lifetime';
      else if (priceId === unlockerMonthly) planKey = 'unlocker_monthly';
      else if (priceId === unlockerYearly)  planKey = 'unlocker_yearly';
      if (!planKey) continue;

      const formatted = item.formattedTotals;
      const totals = item.totals;
      const currencyCode = (preview as any).currencyCode || 'USD';

      const discountAmt = Number(totals?.discount || 0);
      const totalNum = Number(totals?.total || 0);
      const originalNum = totalNum + discountAmt;
      const originalFormatted = discountAmt > 0 ? formatAmount(originalNum, currencyCode) : null;

      prices[planKey] = {
        price: formatted?.total || (totalNum / 100).toFixed(2),
        original: originalFormatted,
        currency: currencyCode,
      };
    }

    return c.json(prices);
  } catch (err) {
    logPaddle(null, 'prices', String(err), 'error');
    return c.json({ error: 'Failed to fetch prices' }, 500);
  }
}
