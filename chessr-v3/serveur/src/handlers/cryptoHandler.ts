/**
 * NOWPayments crypto billing handlers (Hono).
 *
 * ONE-TIME payments only — no crypto subscriptions. Three plan shapes,
 * all priced off the exact same Paddle pricingPreview flow paddleHandler
 * uses (never a client-sent amount):
 *   - flex     — N months (1-11) of Premium at N × current localized
 *                monthly price. Grants plan_expiry = now + N months.
 *   - yearly   — current localized yearly price. Grants plan_expiry =
 *                now + 12 months (hardcoded, not months × monthly).
 *   - lifetime — current localized lifetime price. Grants plan='lifetime',
 *                plan_expiry=null.
 *
 * Endpoints:
 *   - POST /api/crypto/checkout-by-token — token, body: { token, plan, months? }
 *   - POST /api/crypto/ipn               — NOWPayments → us, signed status updates
 *
 * Both endpoints 503 when NOWPAYMENTS_API_KEY / NOWPAYMENTS_IPN_SECRET are
 * unset (crypto rail not configured) or when Paddle itself is disabled
 * (pricing can't be computed without it).
 */

import type { Context } from 'hono';
import { NowPaymentsSDK, type Payment } from '@nowpaymentsio/nowpayments-sdk-nodejs';
import { supabase } from '../lib/supabase.js';
import { dbQuery } from '../lib/db.js';
import { emitEvent } from '../lib/events.js';
import { invalidatePlanCache } from '../lib/premium.js';
import {
  verifyBillingToken,
  getPaddlePrices,
  getSignupIp,
  buildLocationParam,
  getClientIpFromCtx,
  paddle,
  PADDLE_ENABLED,
} from './paddleHandler.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const PUBLIC_SERVER_URL = process.env.PUBLIC_SERVER_URL || 'https://beta.chessr.io';
const IPN_CALLBACK_URL = `${PUBLIC_SERVER_URL}/api/crypto/ipn`;

/** Boot-time defensive flag, mirrors PADDLE_ENABLED's role: if either
 *  NOWPayments env var is missing the endpoints stay disabled and return
 *  503 instead of crashing the process at module load. */
const CRYPTO_ENABLED = !!NOWPAYMENTS_API_KEY && !!NOWPAYMENTS_IPN_SECRET;

// Warn only when PARTIALLY configured (one var set, the other missing) —
// that's almost certainly a mistake. Both absent is the normal "feature
// not enabled on this deploy" state and stays silent, same convention as
// paddleHandler's PRICE_SWITCH_VARS_PRESENT check.
const CRYPTO_VARS_PRESENT = !!NOWPAYMENTS_API_KEY || !!NOWPAYMENTS_IPN_SECRET;
if (CRYPTO_VARS_PRESENT && !CRYPTO_ENABLED) {
  console.warn('[crypto] env vars partially set — crypto endpoints disabled. Set both NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET.');
}

// Lazy-init the SDK only when both env vars are present — same pattern as
// paddleHandler's lazy `paddle` instance.
const nowPayments: NowPaymentsSDK | null = CRYPTO_ENABLED
  ? new NowPaymentsSDK({
      apiKey: NOWPAYMENTS_API_KEY,
      ipnSecret: NOWPAYMENTS_IPN_SECRET,
      ipnCallbackUrl: IPN_CALLBACK_URL,
    })
  : null;

function logCrypto(actor: string | null, op: string, msg: string, kind: 'ok' | 'error' | 'processed' = 'ok'): void {
  const tag = kind === 'error' ? '[crypto][error]' : kind === 'processed' ? '[crypto][processed]' : '[crypto]';
  if (actor) console.log(`${tag} ${actor} ${op} ${msg}`);
  else console.log(`${tag} ${op} ${msg}`);
}

type CryptoPlan = 'flex' | 'yearly' | 'lifetime';

// ─── Localized pricing (never trust a client-sent amount) ───────────────────

/** Resolves the amount to charge in minor units (cents) + ISO currency
 *  code, using the SAME Paddle pricingPreview call paddleHandler uses for
 *  /api/paddle/prices — so this naturally follows the 2026-07-12 price
 *  grid switch and per-country localization (pinned to the user's signup
 *  IP, same as Paddle). `flexMonths` only applies to the 'flex' plan. */
async function computeLocalizedAmountCents(
  c: Context,
  userId: string,
  plan: CryptoPlan,
  flexMonths: number,
): Promise<{ amountCents: number; currency: string } | null> {
  if (!PADDLE_ENABLED) return null;

  const priceKey = plan === 'flex' ? 'monthly' : plan; // yearly/lifetime map 1:1
  const priceId = getPaddlePrices()[priceKey];
  if (!priceId) return null;

  try {
    const clientIp = getClientIpFromCtx(c);
    const signupIp = await getSignupIp(userId);
    const locationParam = buildLocationParam(signupIp, clientIp);

    const preview = await paddle.pricingPreview.preview({
      items: [{ priceId, quantity: 1 }],
      ...locationParam,
    });

    const line = (preview as any).details?.lineItems?.[0];
    const unitTotalCents = Number(line?.totals?.total || 0);
    const currency = (preview as any).currencyCode || 'USD';
    if (!(unitTotalCents > 0)) return null;

    const multiplier = plan === 'flex' ? flexMonths : 1;
    return { amountCents: unitTotalCents * multiplier, currency };
  } catch (err) {
    logCrypto(null, 'pricing', String(err), 'error');
    return null;
  }
}

// ─── orderId encoding/decoding ───────────────────────────────────────────────
// Format: crypto:<plan>:<months|0>:<userId>:<Date.now()>
// `months` is the flex month count (1-11) for plan='flex'; it's 0 (unused
// placeholder) for 'yearly'/'lifetime' — those grant a fixed duration
// (12 months / forever) regardless of what's encoded here.

function buildOrderId(plan: CryptoPlan, flexMonths: number, userId: string): string {
  const monthsField = plan === 'flex' ? flexMonths : 0;
  return `crypto:${plan}:${monthsField}:${userId}:${Date.now()}`;
}

interface ParsedOrder {
  plan: CryptoPlan;
  months: number; // meaningful only for 'flex'
  userId: string;
}

function parseOrderId(orderId: string): ParsedOrder | null {
  const parts = orderId.split(':');
  if (parts.length !== 5 || parts[0] !== 'crypto') return null;
  const [, planRaw, monthsRaw, userId] = parts;
  if (planRaw !== 'flex' && planRaw !== 'yearly' && planRaw !== 'lifetime') return null;
  const months = Number(monthsRaw);
  if (!Number.isInteger(months)) return null;
  if (planRaw === 'flex' && (months < 1 || months > 11)) return null;
  if (!userId) return null;
  return { plan: planRaw, months, userId };
}

// ─── POST /api/crypto/checkout-by-token ──────────────────────────────────────
// Body: { token, plan: 'flex' | 'yearly' | 'lifetime', months? }
// months required + integer 1-11 iff plan === 'flex'.
// Returns: { invoiceUrl }
export async function handleCryptoCheckoutByToken(c: Context): Promise<Response> {
  if (!CRYPTO_ENABLED || !PADDLE_ENABLED) return c.json({ error: 'Crypto payments not configured' }, 503);

  let body: { token?: string; plan?: string; months?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const verified = body.token ? verifyBillingToken(body.token) : null;
  if (!verified) return c.json({ error: 'Invalid or expired billing token' }, 401);

  const plan = body.plan;
  if (plan !== 'flex' && plan !== 'yearly' && plan !== 'lifetime') {
    return c.json({ error: 'Invalid plan. Use: flex, yearly, or lifetime' }, 400);
  }

  let flexMonths = 0;
  if (plan === 'flex') {
    flexMonths = Number(body.months);
    if (!Number.isInteger(flexMonths) || flexMonths < 1 || flexMonths > 11) {
      return c.json({ error: 'months is required and must be an integer between 1 and 11 for plan=flex' }, 400);
    }
  }

  const { userId } = verified;

  const localized = await computeLocalizedAmountCents(c, userId, plan, flexMonths);
  if (!localized) {
    logCrypto(null, 'checkout', `failed to compute localized amount for user=${userId}, plan=${plan}`, 'error');
    return c.json({ error: 'Failed to compute price' }, 500);
  }

  const amount = localized.amountCents / 100;
  const currency = localized.currency.toLowerCase();
  const orderId = buildOrderId(plan, flexMonths, userId);
  const description = plan === 'flex' ? `Chessr Premium — ${flexMonths} month(s)` : `Chessr ${plan === 'yearly' ? 'Premium Yearly' : 'Lifetime'}`;

  // Carry the billing token back so chessr.io/checkout can resume the
  // same session + poll /api/paddle/status-by-token for the grant to land.
  const tokenParam = encodeURIComponent(body.token!);
  const successUrl = `https://chessr.io/checkout?token=${tokenParam}&crypto=1`;
  const cancelUrl = `https://chessr.io/checkout?token=${tokenParam}&crypto=0`;

  try {
    const checkout = await nowPayments!.createCheckout({
      amount,
      currency,
      orderId,
      description,
      ipnCallbackUrl: IPN_CALLBACK_URL,
      successUrl,
      cancelUrl,
    });

    if (!checkout.invoiceUrl) {
      logCrypto(null, 'checkout', `NOWPayments returned no invoice_url for orderId=${orderId}`, 'error');
      return c.json({ error: 'Failed to create crypto checkout' }, 500);
    }

    logCrypto(null, 'checkout', `user=${userId}, plan=${plan}, months=${flexMonths}, amount=${amount} ${currency}, orderId=${orderId}, invoice=${checkout.id}`, 'processed');
    return c.json({ invoiceUrl: checkout.invoiceUrl });
  } catch (err) {
    logCrypto(null, 'checkout', String(err), 'error');
    return c.json({ error: 'Failed to create crypto checkout' }, 500);
  }
}

// ─── POST /api/crypto/ipn ─────────────────────────────────────────────────────
// NOWPayments → us. Signed with `x-nowpayments-sig` (HMAC-SHA512 over the
// deep-key-sorted JSON body — see the SDK's ipn.js). We still read the raw
// text first and parse after, matching the general "never parse-then-hash"
// webhook hygiene even though this particular SDK re-derives the signature
// from the parsed+re-sorted object rather than from raw bytes.
export async function handleCryptoIpn(c: Context): Promise<Response> {
  if (!CRYPTO_ENABLED) return c.json({ error: 'Crypto payments not configured' }, 503);

  const rawBody = await c.req.text();
  const signature = c.req.header('x-nowpayments-sig');

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!signature || !nowPayments!.verifyWebhookSignature(payload, signature)) {
    logCrypto(null, 'ipn', 'invalid IPN signature', 'error');
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const parsed = nowPayments!.parseWebhook(payload, signature, { verify: false }); // already verified above
  if (parsed.type !== 'payment.status_changed') {
    logCrypto(null, 'ipn', 'unhandled/unknown IPN payload shape', 'ok');
    return c.json({ ok: true });
  }

  const payment: Payment = parsed.payment;
  const paymentId = payment.payment_id ?? payment.id;
  const orderId = payment.order_id;
  const status = payment.status; // SDK-normalized: pending/processing/paid/partially_paid/failed/refunded/expired/cancelled

  if (!paymentId || !orderId) {
    logCrypto(null, 'ipn', 'malformed payload — missing payment_id or order_id', 'error');
    return c.json({ error: 'Malformed payload' }, 400);
  }

  // ─── Idempotence FIRST ──────────────────────────────────────────────────
  // Keyed on (paymentId, status) rather than paymentId alone. NOWPayments
  // fires one IPN per status transition (waiting -> confirming -> finished,
  // or -> partially_paid / expired / failed), and each transition is
  // audited exactly once. Keying on paymentId alone would mean an early
  // `partially_paid` audit row permanently blocks a later `finished`/`paid`
  // grant for the SAME payment (e.g. customer tops up an underpaid
  // invoice) — which is exactly the case we must NOT dedupe away. Keying
  // on (paymentId, status) still fully dedupes true retries (NOWPayments
  // redelivering the identical IPN after a timeout/5xx).
  const existing = await dbQuery<{ ok: boolean }>(
    `SELECT 1 AS ok FROM events WHERE type = 'crypto_payment' AND payload->>'paymentId' = $1 AND payload->>'status' = $2 LIMIT 1`,
    [String(paymentId), status],
  );
  if (existing.length > 0) {
    logCrypto(null, 'ipn', `duplicate IPN for payment=${paymentId} status=${status} — already processed`, 'ok');
    return c.json({ ok: true });
  }

  const order = parseOrderId(String(orderId));
  const auditPayload: Record<string, unknown> = {
    paymentId: String(paymentId),
    orderId: String(orderId),
    plan: order?.plan ?? null,
    months: order ? (order.plan === 'yearly' ? 12 : order.plan === 'lifetime' ? null : order.months) : null,
    status,
    rawStatus: payment.payment_status ?? payment.rawStatus ?? null,
    priceAmount: payment.price_amount ?? null,
    priceCurrency: payment.price_currency ?? null,
    payAmount: payment.pay_amount ?? null,
    payCurrency: payment.pay_currency ?? null,
    actuallyPaid: payment.actually_paid ?? null,
    outcomeAmount: payment.outcome_amount ?? null,
    outcomeCurrency: payment.outcome_currency ?? null,
  };

  if (!order) {
    logCrypto(null, 'ipn', `unparseable orderId=${orderId} for payment=${paymentId} — no grant possible`, 'error');
    await emitEvent({ type: 'crypto_payment', payload: { ...auditPayload, error: 'unparseable_order_id' } });
    return c.json({ ok: true });
  }

  const isPaid = status === 'paid'; // SDK maps API 'finished' -> 'paid'
  const isNonGrantingTerminal =
    status === 'partially_paid' || status === 'expired' || status === 'failed' ||
    status === 'cancelled' || status === 'refunded';

  if (isPaid) {
    const { userId, plan } = order;

    const { data: prevSettings } = await supabase
      .from('user_settings')
      .select('plan, plan_expiry')
      .eq('user_id', userId)
      .single();
    const oldPlan = prevSettings?.plan ?? null;
    const oldExpiry = prevSettings?.plan_expiry ?? null;

    let newPlan: 'premium' | 'lifetime';
    let newExpiry: string | null;
    if (plan === 'lifetime') {
      newPlan = 'lifetime';
      newExpiry = null;
    } else {
      const n = plan === 'yearly' ? 12 : order.months; // yearly is always +12, not months*1
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + n);
      newPlan = 'premium';
      newExpiry = expiry.toISOString();
    }

    await supabase
      .from('user_settings')
      .update({ plan: newPlan, plan_expiry: newExpiry, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    invalidatePlanCache(userId);

    await emitEvent({
      type: 'plan_changed',
      user_id: userId,
      payload: {
        oldPlan,
        newPlan,
        oldExpiry,
        newExpiry,
        reason: 'crypto_payment',
        source: 'crypto',
        paymentId: String(paymentId),
      },
    });

    logCrypto(null, 'ipn', `${userId} -> plan=${newPlan}, expiry=${newExpiry}, payment=${paymentId}`, 'processed');
  } else if (isNonGrantingTerminal) {
    logCrypto(null, 'ipn', `payment=${paymentId} (user=${order.userId}) terminal status=${status} — no grant`, 'ok');
  } else {
    // Non-terminal (pending/processing/unknown) — just audit, nothing to do yet.
    logCrypto(null, 'ipn', `payment=${paymentId} (user=${order.userId}) status=${status}`, 'ok');
  }

  // Audit event — doubles as the idempotence marker for this (paymentId,
  // status) pair (see the dedup query above).
  await emitEvent({
    type: 'crypto_payment',
    user_id: order.userId,
    payload: auditPayload,
  });

  return c.json({ ok: true });
}
