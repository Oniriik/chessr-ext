import { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const PADDLE_API_KEY = process.env.PADDLE_API_KEY!;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET!;
const PADDLE_ENVIRONMENT = (process.env.PADDLE_ENVIRONMENT || "sandbox") as
  | "sandbox"
  | "production";

const paddle = new Paddle(PADDLE_API_KEY, {
  environment: PADDLE_ENVIRONMENT === "sandbox" ? Environment.sandbox : Environment.production,
});

// Price IDs for each plan (set in env)
const PADDLE_PRICES: Record<string, string> = {
  monthly: process.env.PADDLE_PRICE_MONTHLY!,
  yearly: process.env.PADDLE_PRICE_YEARLY!,
  lifetime: process.env.PADDLE_PRICE_LIFETIME!,
};

// Price ID → plan mapping (single product with 3 prices)
const PRICE_PLAN_MAP: Record<string, { plan: "premium" | "lifetime"; interval?: string }> = {
  [process.env.PADDLE_PRICE_MONTHLY!]: { plan: "premium", interval: "monthly" },
  [process.env.PADDLE_PRICE_YEARLY!]: { plan: "premium", interval: "yearly" },
  [process.env.PADDLE_PRICE_LIFETIME!]: { plan: "lifetime" },
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// ─── Webhook signature verification ──────────────────────────────────────────

function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!signature || !PADDLE_WEBHOOK_SECRET) return false;

  // Paddle Billing webhook signature format: ts=xxx;h1=xxx
  const parts = signature.split(";").reduce(
    (acc, part) => {
      const [key, val] = part.split("=");
      acc[key] = val;
      return acc;
    },
    {} as Record<string, string>,
  );

  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;

  const payload = `${ts}:${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", PADDLE_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(h1), Buffer.from(expectedSig));
}

// ─── Plan update logic ───────────────────────────────────────────────────────

async function updateUserPlan(
  customerId: string,
  subscriptionId: string,
  productId: string,
  status: string,
  nextBilledAt: string | null,
  canceledAt: string | null,
) {
  const mapping = PRICE_PLAN_MAP[productId];
  if (!mapping) {
    console.error(`[Paddle] Unknown product ID: ${productId}`);
    return;
  }

  // Find user by paddle_customer_id in subscriptions table
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("paddle_customer_id", customerId)
    .limit(1)
    .single();

  if (!sub) {
    console.error(`[Paddle] No user found for customer: ${customerId}`);
    return;
  }

  const userId = sub.user_id;

  // Update subscription record (upsert by user_id — one subscription per user)
  await supabase
    .from("subscriptions")
    .upsert(
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
      { onConflict: "user_id" },
    );

  // Update user_settings based on subscription status
  if (status === "active" || status === "trialing") {
    const planExpiry =
      mapping.plan === "lifetime"
        ? null // lifetime never expires
        : nextBilledAt;

    await supabase
      .from("user_settings")
      .update({
        plan: mapping.plan,
        plan_expiry: planExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    console.log(`[Paddle] ${userId} → plan=${mapping.plan}, expiry=${planExpiry}`);
  } else if (status === "canceled" || status === "past_due") {
    const expiresAt = nextBilledAt || canceledAt;
    const isExpired = expiresAt && new Date(expiresAt).getTime() <= Date.now();

    if (isExpired) {
      // Immediate cancel — downgrade to free now
      await supabase
        .from("user_settings")
        .update({
          plan: "free",
          plan_expiry: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      console.log(`[Paddle] ${userId} → canceled immediately, set to free`);
    } else if (expiresAt) {
      // End-of-period cancel — keep plan active until expiry
      await supabase
        .from("user_settings")
        .update({
          plan_expiry: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      console.log(`[Paddle] ${userId} → canceled, active until ${expiresAt}`);
    }
  }

  // Log the plan change
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  await supabase.from("plan_activity_logs").insert({
    user_id: userId,
    user_email: userData?.user?.email || "",
    action_type: `paddle_${status}`,
    new_plan: status === "canceled" ? "free" : mapping.plan,
    old_plan: null, // we don't track old plan here
    reason: `Paddle ${status} (${subscriptionId})`,
  });
}

// ─── Handle one-time purchase (lifetime) ─────────────────────────────────────

async function handleTransactionCompleted(event: any) {
  const transaction = event.data;
  const customerId = transaction.customer_id;
  const items = transaction.items || [];

  for (const item of items) {
    const productId = item.price?.id;
    const mapping = PRICE_PLAN_MAP[productId];

    if (mapping?.plan === "lifetime") {
      // Find user by paddle_customer_id
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("paddle_customer_id", customerId)
        .limit(1)
        .single();

      if (!sub) {
        console.error(`[Paddle] No user for customer ${customerId} on transaction`);
        return;
      }

      // Update subscription record
      await supabase.from("subscriptions").upsert(
        {
          user_id: sub.user_id,
          paddle_customer_id: customerId,
          paddle_subscription_id: transaction.id,
          paddle_price_id: productId,
          status: "active",
          plan: "lifetime",
          interval: null,
          current_period_end: null,
          canceled_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "paddle_subscription_id" },
      );

      // Set lifetime plan (no expiry)
      await supabase
        .from("user_settings")
        .update({
          plan: "lifetime",
          plan_expiry: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", sub.user_id);

      console.log(`[Paddle] ${sub.user_id} → lifetime (transaction ${transaction.id})`);

      // Log
      const { data: userData } = await supabase.auth.admin.getUserById(sub.user_id);
      await supabase.from("plan_activity_logs").insert({
        user_id: sub.user_id,
        user_email: userData?.user?.email || "",
        action_type: "paddle_lifetime_purchase",
        new_plan: "lifetime",
        reason: `Paddle transaction ${transaction.id}`,
      });
    }
  }
}

// ─── Store payment event ─────────────────────────────────────────────────────

async function storePaymentEvent(eventType: string, event: any) {
  await supabase.from("payment_events").insert({
    event_id: event.event_id,
    event_type: eventType,
    data: event.data,
  });
}

// ─── Webhook HTTP handler ────────────────────────────────────────────────────

export function handlePaddleWebhook(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      // Verify signature
      const signature = req.headers["paddle-signature"] as string | undefined;
      if (!verifyWebhookSignature(body, signature)) {
        console.error("[Paddle] Invalid webhook signature");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }

      const event = JSON.parse(body);
      const eventType = event.event_type;

      console.log(`[Paddle] Webhook: ${eventType}`);

      // Store raw event
      await storePaymentEvent(eventType, event);

      // Process event
      switch (eventType) {
        case "subscription.created":
        case "subscription.updated": {
          const sub = event.data;
          const productId = sub.items?.[0]?.price?.id;
          // Paddle sends scheduled_change.action = "cancel" when user cancels
          // but status is still "active" until effective_at
          const scheduledCancel = sub.scheduled_change?.action === "cancel";
          const effectiveStatus = scheduledCancel ? "canceled" : sub.status;
          const effectiveExpiry = scheduledCancel
            ? sub.scheduled_change.effective_at
            : sub.next_billed_at;
          await updateUserPlan(
            sub.customer_id,
            sub.id,
            productId,
            effectiveStatus,
            effectiveExpiry || null,
            sub.canceled_at || (scheduledCancel ? new Date().toISOString() : null),
          );
          break;
        }

        case "subscription.canceled": {
          const sub = event.data;
          const productId = sub.items?.[0]?.price?.id;
          await updateUserPlan(
            sub.customer_id,
            sub.id,
            productId,
            "canceled",
            sub.next_billed_at || null,
            sub.canceled_at || new Date().toISOString(),
          );
          break;
        }

        case "transaction.completed": {
          await handleTransactionCompleted(event);
          break;
        }

        default:
          console.log(`[Paddle] Unhandled event: ${eventType}`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("[Paddle] Webhook error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  });
}

// ─── Checkout session endpoint ───────────────────────────────────────────────
// POST /api/paddle/checkout — creates a Paddle transaction and returns checkout URL
// Body: { plan: "monthly" | "yearly" | "lifetime" }

export function handlePaddleCheckout(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      // Auth check
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const { plan } = JSON.parse(body) as { plan: string };
      const priceId = PADDLE_PRICES[plan];

      if (!priceId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid plan. Use: monthly, yearly, or lifetime" }));
        return;
      }

      const userId = authData.user.id;
      const userEmail = authData.user.email || "";

      console.log(`[Paddle] Creating checkout: user=${userId}, email=${userEmail}, plan=${plan}, priceId=${priceId}`);

      // Get or create Paddle customer
      let customerId: string | undefined;

      const { data: existingSub } = await supabase
        .from("subscriptions")
        .select("paddle_customer_id")
        .eq("user_id", userId)
        .limit(1)
        .single();

      if (existingSub?.paddle_customer_id) {
        // Verify customer still exists in Paddle
        try {
          await paddle.customers.get(existingSub.paddle_customer_id);
          customerId = existingSub.paddle_customer_id;
          console.log(`[Paddle] Reusing customer: ${customerId}`);
        } catch {
          console.log(`[Paddle] Customer ${existingSub.paddle_customer_id} not found, creating new one`);
          // Clear stale reference
          await supabase.from("subscriptions").delete().eq("user_id", userId);
        }
      }

      if (!customerId) {
        try {
          const customer = await paddle.customers.create({
            email: userEmail,
          });
          customerId = customer.id;
          console.log(`[Paddle] Created customer: ${customerId}`);
        } catch (createErr: any) {
          // Customer already exists in Paddle — find by email
          if (createErr?.code === 'conflict' || createErr?.type === 'request_error') {
            const customers = await paddle.customers.list({ email: [userEmail] });
            for await (const c of customers) {
              customerId = c.id;
              console.log(`[Paddle] Found existing customer: ${customerId}`);
              break;
            }
          }
          if (!customerId) throw createErr;
        }

        await supabase.from("subscriptions").upsert(
          {
            user_id: userId,
            paddle_customer_id: customerId,
            status: "pending",
            plan: "free",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      }

      // Create transaction to get checkout URL
      const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;
      const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customerId,
        customData: { userId },
        ...(discountId ? { discountId } : {}),
      });

      const txnId = transaction.id;

      console.log(`[Paddle] Checkout created for ${userEmail} → ${plan} (txn=${txnId})`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ transactionId: txnId }));
    } catch (err) {
      console.error("[Paddle] Checkout error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  });
}

// ─── Switch plan endpoint ────────────────────────────────────────────────────
// POST /api/paddle/switch — switch between monthly ↔ yearly with proration

export function handlePaddleSwitch(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const { plan } = JSON.parse(body) as { plan: "monthly" | "yearly" };
      const priceId = PADDLE_PRICES[plan];

      if (!priceId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid plan. Use: monthly or yearly" }));
        return;
      }

      const userId = authData.user.id;

      // Get current subscription
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("paddle_subscription_id")
        .eq("user_id", userId)
        .limit(1)
        .single();

      if (!sub?.paddle_subscription_id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active subscription found" }));
        return;
      }

      // Update subscription with proration and discount
      const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;
      const updated = await paddle.subscriptions.update(sub.paddle_subscription_id, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "prorated_immediately",
        ...(discountId ? { discount: { id: discountId, effectiveFrom: "immediately" } } : {}),
      });

      console.log(`[Paddle] Switch to ${plan} for ${authData.user.email} (${sub.paddle_subscription_id})`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, nextBilledAt: updated.nextBilledAt }));
    } catch (err) {
      console.error("[Paddle] Switch error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to switch plan" }));
    }
  });
}

// ─── Preview switch endpoint ─────────────────────────────────────────────────
// POST /api/paddle/preview-switch — preview proration for plan switch

export function handlePaddlePreviewSwitch(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const { plan } = JSON.parse(body) as { plan: "monthly" | "yearly" };
      const priceId = PADDLE_PRICES[plan];

      if (!priceId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid plan" }));
        return;
      }

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("paddle_subscription_id")
        .eq("user_id", authData.user.id)
        .limit(1)
        .single();

      if (!sub?.paddle_subscription_id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active subscription" }));
        return;
      }

      const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;
      const preview = await paddle.subscriptions.previewUpdate(sub.paddle_subscription_id, {
        items: [{ priceId, quantity: 1 }],
        prorationBillingMode: "prorated_immediately",
        ...(discountId ? { discount: { id: discountId, effectiveFrom: "immediately" } } : {}),
      });

      const summary = preview.updateSummary;
      const immediate = preview.immediateTransaction;

      // Extract line items for detailed breakdown (amounts include tax)
      const lineItems = (immediate?.details as any)?.lineItems || [];
      const creditLine = lineItems.find((li: any) => li.proration);
      const chargeLine = lineItems.find((li: any) => !li.proration);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        // TTC amounts from line items
        credit: creditLine ? { amount: creditLine.totals.total, currency: creditLine.totals.currencyCode || 'EUR' } : null,
        charge: chargeLine ? { amount: chargeLine.totals.total, currency: chargeLine.totals.currencyCode || 'EUR' } : null,
        // Total TTC from immediate transaction
        result: immediate?.details?.totals ? {
          action: 'charge',
          amount: immediate.details.totals.total,
          currency: immediate.details.totals.currencyCode || 'EUR',
        } : (summary?.result ? { action: summary.result.action, amount: summary.result.amount, currency: summary.result.currencyCode } : null),
        tax: immediate?.details?.totals?.tax || null,
        nextBilledAt: preview.nextBilledAt,
      }));
    } catch (err) {
      console.error("[Paddle] Preview switch error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to preview switch" }));
    }
  });
}

// ─── Preview lifetime upgrade endpoint ────────────────────────────────────────
// POST /api/paddle/preview-lifetime — preview credit from canceling current sub + lifetime price

export function handlePaddlePreviewLifetime(req: IncomingMessage, res: ServerResponse) {
  (async () => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("paddle_subscription_id, current_period_end, interval")
        .eq("user_id", authData.user.id)
        .limit(1)
        .single();

      if (!sub?.paddle_subscription_id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active subscription" }));
        return;
      }

      // Get subscription from Paddle to calculate remaining credit
      const subscription = await paddle.subscriptions.get(sub.paddle_subscription_id);
      const currentItem = subscription.items?.[0];
      const priceAmount = Number(currentItem?.price?.unitPrice?.amount || 0);
      const billingStart = subscription.currentBillingPeriod?.startsAt;
      const billingEnd = subscription.currentBillingPeriod?.endsAt;

      let credit = 0;
      if (billingStart && billingEnd && priceAmount > 0) {
        const start = new Date(billingStart).getTime();
        const end = new Date(billingEnd).getTime();
        const now = Date.now();
        const totalDays = (end - start) / (1000 * 60 * 60 * 24);
        const remainingDays = Math.max(0, (end - now) / (1000 * 60 * 60 * 24));
        credit = Math.round((remainingDays / totalDays) * priceAmount);
      }

      // Get lifetime price
      const lifetimePriceId = PADDLE_PRICES["lifetime"];
      const lifetimePrice = await paddle.prices.get(lifetimePriceId);
      const lifetimeAmount = Number(lifetimePrice.unitPrice?.amount || 0);

      // Apply discount if any
      const discountId = process.env.PADDLE_DISCOUNT_ID;
      let discountAmount = 0;
      if (discountId) {
        try {
          const discount = await paddle.discounts.get(discountId);
          if (discount.type === "percentage") {
            discountAmount = Math.round(lifetimeAmount * Number(discount.amount) / 100);
          } else if (discount.type === "flat") {
            discountAmount = Number(discount.amount);
          }
        } catch {}
      }

      const discountedLifetime = lifetimeAmount - discountAmount;
      const total = Math.max(0, discountedLifetime - credit);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        lifetimePrice: lifetimeAmount,
        discount: discountAmount,
        credit,
        total,
        currentInterval: sub.interval,
        currency: lifetimePrice.unitPrice?.currencyCode || "USD",
      }));
    } catch (err) {
      console.error("[Paddle] Preview lifetime error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to preview lifetime upgrade" }));
    }
  })();
}

// ─── Upgrade to lifetime endpoint ────────────────────────────────────────────
// POST /api/paddle/upgrade-lifetime — cancel current sub immediately + create lifetime checkout

export function handlePaddleUpgradeLifetime(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const userId = authData.user.id;
      const userEmail = authData.user.email || "";

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("paddle_subscription_id, paddle_customer_id")
        .eq("user_id", userId)
        .limit(1)
        .single();

      if (!sub?.paddle_subscription_id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active subscription" }));
        return;
      }

      // Cancel current subscription immediately (Paddle issues prorated credit)
      await paddle.subscriptions.cancel(sub.paddle_subscription_id, {
        effectiveFrom: "immediately",
      });

      console.log(`[Paddle] Canceled sub ${sub.paddle_subscription_id} immediately for lifetime upgrade (${userEmail})`);

      // Create lifetime checkout transaction
      const priceId = PADDLE_PRICES["lifetime"];
      const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;

      const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customerId: sub.paddle_customer_id!,
        customData: { userId },
        ...(discountId ? { discountId } : {}),
      });

      console.log(`[Paddle] Lifetime checkout for ${userEmail} (txn=${transaction.id})`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ transactionId: transaction.id }));
    } catch (err) {
      console.error("[Paddle] Upgrade lifetime error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to upgrade to lifetime" }));
    }
  });
}

// ─── Cancel subscription endpoint ────────────────────────────────────────────
// POST /api/paddle/cancel — cancels subscription at end of billing period

export function handlePaddleCancel(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const userId = authData.user.id;
      const userEmail = authData.user.email || "";

      // Parse reason
      const { reason, details } = JSON.parse(body || "{}");

      // Get subscription
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("paddle_subscription_id, plan, interval")
        .eq("user_id", userId)
        .limit(1)
        .single();

      if (!sub?.paddle_subscription_id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active subscription found" }));
        return;
      }

      // Cancel via Paddle API at end of billing period
      await paddle.subscriptions.cancel(sub.paddle_subscription_id, {
        effectiveFrom: "next_billing_period",
      });

      console.log(`[Paddle] Cancel requested by ${userEmail} (${sub.paddle_subscription_id}), reason: ${reason || "none"}`);

      // Store cancel reason
      if (reason) {
        await supabase.from("cancel_reasons").insert({
          user_id: userId,
          user_email: userEmail,
          reason,
          details: details || null,
          plan: sub.plan,
          interval: sub.interval,
        });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("[Paddle] Cancel error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to cancel subscription" }));
    }
  });
}

// ─── Subscription status endpoint ────────────────────────────────────────────
// GET /api/paddle/subscription — returns current subscription for authenticated user

export function handlePaddleSubscriptionStatus(req: IncomingMessage, res: ServerResponse) {
  (async () => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", authData.user.id)
        .limit(1)
        .single();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ subscription: sub || null }));
    } catch (err) {
      console.error("[Paddle] Status error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
    }
  })();
}

// ─── Localized prices endpoint ───────────────────────────────────────────────
// GET /api/paddle/prices — returns localized prices based on client IP

export function handlePaddlePrices(req: IncomingMessage, res: ServerResponse) {
  (async () => {
    try {
      // Get client IP for geolocation
      const forwarded = req.headers["x-forwarded-for"];
      const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || undefined;

      const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;

      const preview = await paddle.pricingPreview.preview({
        items: [
          { priceId: PADDLE_PRICES["monthly"], quantity: 1 },
          { priceId: PADDLE_PRICES["yearly"], quantity: 1 },
          { priceId: PADDLE_PRICES["lifetime"], quantity: 1 },
        ],
        ...(clientIp && !clientIp.startsWith("127.") && !clientIp.startsWith("::1") ? { customerIpAddress: clientIp } : {}),
        ...(discountId ? { discountId } : {}),
      });

      console.log(`[Paddle] Prices preview: discountId=${discountId}, items=${JSON.stringify((preview as any).details?.lineItems?.map((i: any) => ({ id: i.price?.id, subtotal: i.totals?.subtotal, total: i.totals?.total, discount: i.totals?.discount, formatted: i.formattedTotals })))}`);

      const prices: Record<string, { price: string; original: string | null; currency: string }> = {};

      for (const item of (preview as any).details?.lineItems || []) {
        const priceId = item.price?.id;
        let planKey: string | null = null;
        if (priceId === PADDLE_PRICES["monthly"]) planKey = "monthly";
        else if (priceId === PADDLE_PRICES["yearly"]) planKey = "yearly";
        else if (priceId === PADDLE_PRICES["lifetime"]) planKey = "lifetime";

        if (planKey) {
          const formatted = item.formattedTotals;
          const totals = item.totals;
          const currencyCode = (preview as any).currencyCode || "USD";

          // Detect discount via the discount field
          const discountAmt = Number(totals?.discount || 0);
          const hasDiscount = discountAmt > 0;

          // Original price = total + discount amount (what they'd pay without discount)
          const totalNum = Number(totals?.total || 0);
          const originalNum = totalNum + discountAmt;

          // Format original with currency symbol
          let originalFormatted: string | null = null;
          if (hasDiscount) {
            // Use same formatting style as Paddle's formatted total
            const sym = currencyCode === "EUR" ? "€" : currencyCode === "INR" ? "₹" : currencyCode === "GBP" ? "£" : currencyCode === "USD" ? "$" : currencyCode + " ";
            originalFormatted = `${sym}${(originalNum / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          }

          prices[planKey] = {
            price: formatted?.total || (totalNum / 100).toFixed(2),
            original: originalFormatted,
            currency: currencyCode,
          };
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(prices));
    } catch (err) {
      console.error("[Paddle] Prices error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to fetch prices" }));
    }
  })();
}
