import { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { Paddle, Environment, EventName } from "@paddle/paddle-node-sdk";

// ─── Config ──────────────────────────────────────────────────────────────────

const PADDLE_API_KEY = process.env.PADDLE_API_KEY!;
const PADDLE_WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET!;
const PADDLE_ENVIRONMENT = process.env.PADDLE_ENVIRONMENT === "sandbox" ? Environment.sandbox : Environment.production;

const paddle = new Paddle(PADDLE_API_KEY, { environment: PADDLE_ENVIRONMENT });

// Price IDs for each plan
const PADDLE_PRICES: Record<string, string> = {
  monthly: process.env.PADDLE_PRICE_MONTHLY!,
  yearly: process.env.PADDLE_PRICE_YEARLY!,
  lifetime: process.env.PADDLE_PRICE_LIFETIME!,
};

// Reverse: price ID → plan mapping
const PRICE_PLAN_MAP: Record<string, { plan: "premium" | "lifetime"; interval?: string }> = {
  [process.env.PADDLE_PRICE_MONTHLY!]: { plan: "premium", interval: "monthly" },
  [process.env.PADDLE_PRICE_YEARLY!]: { plan: "premium", interval: "yearly" },
  [process.env.PADDLE_PRICE_LIFETIME!]: { plan: "lifetime" },
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

function json(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function getAuthUser(req: IncomingMessage) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// ─── Plan update logic ───────────────────────────────────────────────────────

async function updateUserPlan(
  userId: string,
  paddleSubscriptionId: string,
  paddleCustomerId: string | null,
  priceId: string,
  status: string,
  currentPeriodEnd: string | null,
  canceledAt: string | null,
) {
  const mapping = PRICE_PLAN_MAP[priceId];
  if (!mapping) {
    console.error(`[Paddle] Unknown price ID: ${priceId}`);
    return;
  }

  // Update subscription record
  await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        paddle_subscription_id: paddleSubscriptionId,
        paddle_customer_id: paddleCustomerId,
        paddle_price_id: priceId,
        status,
        plan: mapping.plan,
        interval: mapping.interval || null,
        current_period_end: currentPeriodEnd,
        canceled_at: canceledAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  // Update user_settings based on status
  if (status === "active") {
    const planExpiry = mapping.plan === "lifetime" ? null : currentPeriodEnd;
    await supabase
      .from("user_settings")
      .update({
        plan: mapping.plan,
        plan_expiry: planExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    console.log(`[Paddle] ${userId} → plan=${mapping.plan}, expiry=${planExpiry}`);
  } else if (status === "canceled") {
    const expiresAt = currentPeriodEnd || canceledAt;
    const isExpired = expiresAt && new Date(expiresAt).getTime() <= Date.now();

    if (isExpired) {
      await supabase
        .from("user_settings")
        .update({ plan: "free", plan_expiry: null, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      console.log(`[Paddle] ${userId} → canceled & expired, set to free`);
    } else if (expiresAt) {
      await supabase
        .from("user_settings")
        .update({ plan_expiry: expiresAt, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      console.log(`[Paddle] ${userId} → canceled, active until ${expiresAt}`);
    }
  } else if (status === "revoked") {
    await supabase
      .from("user_settings")
      .update({ plan: "free", plan_expiry: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    console.log(`[Paddle] ${userId} → revoked, set to free`);
  }

  // Log the plan change
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  await supabase.from("plan_activity_logs").insert({
    user_id: userId,
    user_email: userData?.user?.email || "",
    action_type: `paddle_${status}`,
    new_plan: status === "canceled" || status === "revoked" ? "free" : mapping.plan,
    old_plan: null,
    reason: `Paddle ${status} (${paddleSubscriptionId})`,
  });

  // Trigger immediate Discord role sync
  triggerDiscordRoleSync(userId);
}

function triggerDiscordRoleSync(userId: string) {
  const botUrl = process.env.DISCORD_BOT_URL || "http://chessr-discord:3100";
  fetch(`${botUrl}/sync-roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  }).catch((err) => {
    console.error(`[Paddle] Failed to trigger role sync for ${userId}:`, err.message);
  });
}

// ─── Webhook HTTP handler ────────────────────────────────────────────────────

export async function handlePaddleWebhook(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  try {
    const signature = req.headers["paddle-signature"] as string;
    if (!signature) {
      json(res, 401, { error: "Missing Paddle-Signature header" });
      return;
    }

    const event = paddle.webhooks.unmarshal(body, PADDLE_WEBHOOK_SECRET, signature);
    if (!event) {
      json(res, 401, { error: "Invalid signature" });
      return;
    }

    console.log(`[Paddle] Webhook: ${event.eventType}`);

    // Store raw event
    await supabase.from("payment_events").insert({
      event_id: event.eventId,
      event_type: event.eventType,
      data: event.data,
    });

    switch (event.eventType) {
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionUpdated: {
        const data = event.data as any;
        const priceId = data.items?.[0]?.price?.id;
        const userId = data.customData?.user_id;
        const customerId = data.customerId;
        if (!userId || !priceId) {
          console.error(`[Paddle] Missing userId or priceId in ${event.eventType}`, { priceId, userId });
          break;
        }
        const periodEnd = data.currentBillingPeriod?.endsAt || null;
        await updateUserPlan(
          userId,
          data.id,
          customerId,
          priceId,
          "active",
          periodEnd,
          null,
        );
        break;
      }

      case EventName.SubscriptionCanceled: {
        const data = event.data as any;
        const priceId = data.items?.[0]?.price?.id;
        const userId = data.customData?.user_id;
        const customerId = data.customerId;
        if (!userId || !priceId) break;

        // Check if this is an immediate cancellation or end-of-period
        const scheduledChange = data.scheduledChange;
        const isImmediate = !scheduledChange && data.status === "canceled";
        const periodEnd = data.currentBillingPeriod?.endsAt || null;

        if (isImmediate) {
          await updateUserPlan(
            userId,
            data.id,
            customerId,
            priceId,
            "revoked",
            null,
            data.canceledAt || new Date().toISOString(),
          );
        } else {
          await updateUserPlan(
            userId,
            data.id,
            customerId,
            priceId,
            "canceled",
            periodEnd,
            data.canceledAt || new Date().toISOString(),
          );
        }
        break;
      }

      case EventName.TransactionCompleted: {
        // Handle lifetime one-time purchase (no subscription)
        const data = event.data as any;
        if (data.subscriptionId) break; // Skip subscription renewals

        const items = data.items || [];
        for (const item of items) {
          const priceId = item.price?.id;
          const mapping = PRICE_PLAN_MAP[priceId];
          if (mapping?.plan !== "lifetime") continue;

          const userId = data.customData?.user_id;
          if (!userId) {
            console.error("[Paddle] No userId on lifetime transaction");
            break;
          }

          await supabase.from("subscriptions").upsert(
            {
              user_id: userId,
              paddle_subscription_id: data.id,
              paddle_customer_id: data.customerId,
              paddle_price_id: priceId,
              status: "active",
              plan: "lifetime",
              interval: null,
              current_period_end: null,
              canceled_at: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );

          await supabase
            .from("user_settings")
            .update({ plan: "lifetime", plan_expiry: null, updated_at: new Date().toISOString() })
            .eq("user_id", userId);

          console.log(`[Paddle] ${userId} → lifetime (transaction ${data.id})`);

          const { data: userData } = await supabase.auth.admin.getUserById(userId);
          await supabase.from("plan_activity_logs").insert({
            user_id: userId,
            user_email: userData?.user?.email || "",
            action_type: "paddle_lifetime_purchase",
            new_plan: "lifetime",
            reason: `Paddle transaction ${data.id}`,
          });

          triggerDiscordRoleSync(userId);
        }
        break;
      }

      default:
        console.log(`[Paddle] Unhandled event: ${event.eventType}`);
    }

    json(res, 200, { ok: true });
  } catch (err: any) {
    console.error("[Paddle] Webhook error:", err);
    json(res, 500, { error: "Internal error" });
  }
}

// ─── Checkout session endpoint ───────────────────────────────────────────────

export async function handlePaddleCheckout(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return json(res, 401, { error: "Authentication required" });

    const { plan, successUrl } = JSON.parse(body) as { plan: string; successUrl?: string };
    const priceId = PADDLE_PRICES[plan];

    if (!priceId) {
      return json(res, 400, { error: "Invalid plan. Use: monthly, yearly, or lifetime" });
    }

    const userId = authUser.id;
    const userEmail = authUser.email || "";

    console.log(`[Paddle] Creating checkout: user=${userId}, email=${userEmail}, plan=${plan}`);

    const discountId = process.env.PADDLE_DISCOUNT_ID || undefined;

    // Create transaction via Paddle API with user data
    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customData: { user_id: userId, email: userEmail },
      ...(discountId ? { discountId } : {}),
    });

    if (!transaction.id) {
      console.error("[Paddle] No transaction ID returned");
      return json(res, 500, { error: "Failed to create checkout" });
    }

    // Build URL to our pay page which loads Paddle.js overlay
    const returnUrl = successUrl || "";
    const serverSuccessUrl = `https://engine.chessr.io/api/paddle/success?return=${encodeURIComponent(returnUrl)}`;
    const checkoutUrl = `https://engine.chessr.io/api/paddle/pay?txn=${transaction.id}&success=${encodeURIComponent(serverSuccessUrl)}`;

    console.log(`[Paddle] Checkout created for ${userEmail} → ${plan} (${transaction.id})`);

    json(res, 200, { url: checkoutUrl });
  } catch (err) {
    console.error("[Paddle] Checkout error:", err);
    json(res, 500, { error: "Internal error" });
  }
}

// ─── Checkout pay page (Paddle.js overlay) ──────────────────────────────────
// GET /api/paddle/pay?txn=xxx&success=xxx — page that loads Paddle.js and opens overlay

export async function handlePaddlePay(req: IncomingMessage, res: ServerResponse) {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const txnId = urlObj.searchParams.get("txn") || "";
    const successUrl = urlObj.searchParams.get("success") || "";

    if (!txnId) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing transaction ID");
      return;
    }

    const paddleEnv = PADDLE_ENVIRONMENT === Environment.sandbox ? "sandbox" : "production";
    const clientToken = process.env.PADDLE_CLIENT_TOKEN || "";

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><head><title>Chessr — Checkout</title>
<style>body{margin:0;background:#08080f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}p{color:rgba(255,255,255,0.6);font-size:14px;}.spinner{width:24px;height:24px;border:2px solid rgba(255,255,255,0.2);border-top-color:#22d3ee;border-radius:50%;animation:spin .6s linear infinite;margin:0 auto 12px;}@keyframes spin{to{transform:rotate(360deg)}}</style>
</head><body>
<div><div class="spinner"></div><p>Loading checkout...</p></div>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"><\/script>
<script>
Paddle.Environment.set("${paddleEnv}");
Paddle.Setup({
  token: "${clientToken}",
  eventCallback: function(ev) {
    if (ev.name === "checkout.completed") {
      window.location.href = decodeURIComponent("${encodeURIComponent(successUrl)}");
    }
  }
});
Paddle.Checkout.open({ transactionId: "${txnId}" });
<\/script>
</body></html>`);
  } catch (err) {
    console.error("[Paddle] Pay page error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong");
  }
}

// ─── Checkout success redirect ───────────────────────────────────────────────
// GET /api/paddle/success?return=xxx — redirect back to extension after checkout

export async function handlePaddleSuccess(req: IncomingMessage, res: ServerResponse) {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const returnUrl = urlObj.searchParams.get("return") || "";

    // Redirect to extension billing page or fallback
    if (returnUrl) {
      res.writeHead(302, { Location: returnUrl });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Chessr — Payment Successful</title>
<style>body{margin:0;background:#08080f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}h1{font-size:24px;margin-bottom:8px;}p{color:rgba(255,255,255,0.6);}</style>
</head><body><div><h1>Payment successful!</h1><p>You can close this tab and return to Chessr.</p></div></body></html>`);
    }
  } catch (err) {
    console.error("[Paddle] Success redirect error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong");
  }
}

// ─── Cancel subscription endpoint ────────────────────────────────────────────

export async function handlePaddleCancel(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return json(res, 401, { error: "Authentication required" });

    const userId = authUser.id;
    const userEmail = authUser.email || "";
    const { reason, details } = JSON.parse(body || "{}");

    // Get subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("paddle_subscription_id, plan, interval")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (!sub?.paddle_subscription_id) {
      return json(res, 400, { error: "No active subscription found" });
    }

    // Cancel at end of billing period via Paddle API
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

    json(res, 200, { ok: true });
  } catch (err) {
    console.error("[Paddle] Cancel error:", err);
    json(res, 500, { error: "Failed to cancel subscription" });
  }
}

// ─── Customer portal endpoint ────────────────────────────────────────────────
// POST /api/paddle/portal — returns Paddle customer portal URL

export async function handlePaddlePortal(req: IncomingMessage, res: ServerResponse) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return json(res, 401, { error: "Authentication required" });

    // Get subscription ID from our DB
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("paddle_subscription_id")
      .eq("user_id", authUser.id)
      .limit(1)
      .single();

    if (!sub?.paddle_subscription_id) {
      return json(res, 400, { error: "No subscription found" });
    }

    // Get subscription from Paddle to retrieve the update payment method transaction
    const updateTxn = await paddle.subscriptions.getPaymentMethodChangeTransaction(sub.paddle_subscription_id);

    const checkoutUrl = updateTxn.checkout?.url;
    if (!checkoutUrl) {
      return json(res, 500, { error: "Failed to get management URL" });
    }

    console.log(`[Paddle] Portal (payment update) for ${authUser.email}`);

    json(res, 200, { url: checkoutUrl });
  } catch (err) {
    console.error("[Paddle] Portal error:", err);
    json(res, 500, { error: "Failed to create portal session" });
  }
}

// ─── Subscription status endpoint ────────────────────────────────────────────

export async function handlePaddleSubscriptionStatus(req: IncomingMessage, res: ServerResponse) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return json(res, 401, { error: "Authentication required" });

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", authUser.id)
      .limit(1)
      .single();

    json(res, 200, { subscription: sub || null });
  } catch (err) {
    console.error("[Paddle] Status error:", err);
    json(res, 500, { error: "Internal error" });
  }
}
