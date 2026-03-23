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

// Product ID → plan mapping
const PRODUCT_PLAN_MAP: Record<string, { plan: "premium" | "lifetime"; interval?: string }> = {
  [process.env.PADDLE_PRODUCT_MONTHLY!]: { plan: "premium", interval: "monthly" },
  [process.env.PADDLE_PRODUCT_YEARLY!]: { plan: "premium", interval: "yearly" },
  [process.env.PADDLE_PRODUCT_LIFETIME!]: { plan: "lifetime" },
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
  const mapping = PRODUCT_PLAN_MAP[productId];
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

  // Update subscription record
  await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        paddle_customer_id: customerId,
        paddle_subscription_id: subscriptionId,
        paddle_product_id: productId,
        status,
        plan: mapping.plan,
        interval: mapping.interval || null,
        current_period_end: nextBilledAt,
        canceled_at: canceledAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "paddle_subscription_id" },
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
    // On cancellation, keep plan active until period end
    // The cron job (check-expirations) will downgrade when expired
    if (canceledAt) {
      await supabase
        .from("user_settings")
        .update({
          plan_expiry: nextBilledAt || canceledAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }
    console.log(`[Paddle] ${userId} → ${status}, expires=${nextBilledAt || canceledAt}`);
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
    const productId = item.price?.product_id;
    const mapping = PRODUCT_PLAN_MAP[productId];

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
          paddle_product_id: productId,
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
    paddle_event_id: event.event_id,
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
          const productId = sub.items?.[0]?.price?.product_id;
          await updateUserPlan(
            sub.customer_id,
            sub.id,
            productId,
            sub.status,
            sub.next_billed_at || null,
            sub.canceled_at || null,
          );
          break;
        }

        case "subscription.canceled": {
          const sub = event.data;
          const productId = sub.items?.[0]?.price?.product_id;
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
        const customer = await paddle.customers.create({
          email: userEmail,
        });
        customerId = customer.id;
        console.log(`[Paddle] Created customer: ${customerId}`);

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
      const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customerId,
        customData: { userId },
      });

      const checkoutUrl = transaction.checkout?.url;

      if (!checkoutUrl) {
        console.error("[Paddle] No checkout URL returned", transaction);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to create checkout" }));
        return;
      }

      console.log(`[Paddle] Checkout created for ${userEmail} → ${plan} (${checkoutUrl})`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ checkoutUrl }));
    } catch (err) {
      console.error("[Paddle] Checkout error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal error" }));
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
