import { IncomingMessage, ServerResponse } from "http";
import { createClient } from "@supabase/supabase-js";
import { Polar } from "@polar-sh/sdk";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";

// ─── Config ──────────────────────────────────────────────────────────────────

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN!;
const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET!;

const polar = new Polar({ accessToken: POLAR_ACCESS_TOKEN });

// Product IDs for each plan
const POLAR_PRODUCTS: Record<string, string> = {
  monthly: process.env.POLAR_PRODUCT_MONTHLY!,
  yearly: process.env.POLAR_PRODUCT_YEARLY!,
  lifetime: process.env.POLAR_PRODUCT_LIFETIME!,
};

// Reverse: product ID → plan mapping
const PRODUCT_PLAN_MAP: Record<string, { plan: "premium" | "lifetime"; interval?: string }> = {
  [process.env.POLAR_PRODUCT_MONTHLY!]: { plan: "premium", interval: "monthly" },
  [process.env.POLAR_PRODUCT_YEARLY!]: { plan: "premium", interval: "yearly" },
  [process.env.POLAR_PRODUCT_LIFETIME!]: { plan: "lifetime" },
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
  polarSubscriptionId: string,
  productId: string,
  status: string,
  currentPeriodEnd: string | null,
  canceledAt: string | null,
) {
  const mapping = PRODUCT_PLAN_MAP[productId];
  if (!mapping) {
    console.error(`[Polar] Unknown product ID: ${productId}`);
    return;
  }

  // Update subscription record
  await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        polar_subscription_id: polarSubscriptionId,
        polar_product_id: productId,
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
    console.log(`[Polar] ${userId} → plan=${mapping.plan}, expiry=${planExpiry}`);
  } else if (status === "canceled") {
    const expiresAt = currentPeriodEnd || canceledAt;
    const isExpired = expiresAt && new Date(expiresAt).getTime() <= Date.now();

    if (isExpired) {
      await supabase
        .from("user_settings")
        .update({ plan: "free", plan_expiry: null, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      console.log(`[Polar] ${userId} → canceled & expired, set to free`);
    } else if (expiresAt) {
      await supabase
        .from("user_settings")
        .update({ plan_expiry: expiresAt, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      console.log(`[Polar] ${userId} → canceled, active until ${expiresAt}`);
    }
  } else if (status === "revoked") {
    await supabase
      .from("user_settings")
      .update({ plan: "free", plan_expiry: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    console.log(`[Polar] ${userId} → revoked, set to free`);
  }

  // Log the plan change
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  await supabase.from("plan_activity_logs").insert({
    user_id: userId,
    user_email: userData?.user?.email || "",
    action_type: `polar_${status}`,
    new_plan: status === "canceled" || status === "revoked" ? "free" : mapping.plan,
    old_plan: null,
    reason: `Polar ${status} (${polarSubscriptionId})`,
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
    console.error(`[Polar] Failed to trigger role sync for ${userId}:`, err.message);
  });
}

// ─── Webhook HTTP handler ────────────────────────────────────────────────────

export async function handlePolarWebhook(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  try {
    const event = validateEvent(body, Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || ""])
    ), POLAR_WEBHOOK_SECRET);

    console.log(`[Polar] Webhook: ${event.type}`);

    // Store raw event
    await supabase.from("payment_events").insert({
      event_id: event.type + "_" + Date.now(),
      event_type: event.type,
      data: event.data,
    });

    const data = event.data as any;

    switch (event.type) {
      case "subscription.active":
      case "subscription.updated": {
        const productId = data.product?.id || data.productId;
        const userId = data.customer?.externalId || data.metadata?.user_id;
        if (!userId || !productId) {
          console.error(`[Polar] Missing userId or productId in ${event.type}`, { productId, userId });
          break;
        }
        await updateUserPlan(
          userId,
          data.id,
          productId,
          "active",
          data.currentPeriodEnd || null,
          null,
        );
        break;
      }

      case "subscription.canceled": {
        const productId = data.product?.id || data.productId;
        const userId = data.customer?.externalId || data.metadata?.user_id;
        if (!userId || !productId) break;
        await updateUserPlan(
          userId,
          data.id,
          productId,
          "canceled",
          data.currentPeriodEnd || null,
          data.canceledAt || new Date().toISOString(),
        );
        break;
      }

      case "subscription.revoked": {
        const productId = data.product?.id || data.productId;
        const userId = data.customer?.externalId || data.metadata?.user_id;
        if (!userId || !productId) break;
        await updateUserPlan(
          userId,
          data.id,
          productId,
          "revoked",
          null,
          new Date().toISOString(),
        );
        break;
      }

      case "order.paid": {
        // Handle lifetime one-time purchase
        const items = data.items || data.lineItems || [];
        for (const item of items) {
          const productId = item.productId || item.product?.id;
          const mapping = PRODUCT_PLAN_MAP[productId];
          if (mapping?.plan !== "lifetime") continue;

          const userId = data.customer?.externalId || data.metadata?.user_id;
          if (!userId) {
            console.error("[Polar] No userId on lifetime order");
            break;
          }

          await supabase.from("subscriptions").upsert(
            {
              user_id: userId,
              polar_subscription_id: data.id,
              polar_product_id: productId,
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

          console.log(`[Polar] ${userId} → lifetime (order ${data.id})`);

          const { data: userData } = await supabase.auth.admin.getUserById(userId);
          await supabase.from("plan_activity_logs").insert({
            user_id: userId,
            user_email: userData?.user?.email || "",
            action_type: "polar_lifetime_purchase",
            new_plan: "lifetime",
            reason: `Polar order ${data.id}`,
          });

          triggerDiscordRoleSync(userId);
        }
        break;
      }

      default:
        console.log(`[Polar] Unhandled event: ${event.type}`);
    }

    json(res, 200, { ok: true });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.error("[Polar] Invalid webhook signature");
      json(res, 401, { error: "Invalid signature" });
      return;
    }
    console.error("[Polar] Webhook error:", err);
    json(res, 500, { error: "Internal error" });
  }
}

// ─── Checkout session endpoint ───────────────────────────────────────────────

export async function handlePolarCheckout(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return json(res, 401, { error: "Authentication required" });

    const { plan, successUrl } = JSON.parse(body) as { plan: string; successUrl?: string };
    const productId = POLAR_PRODUCTS[plan];

    if (!productId) {
      return json(res, 400, { error: "Invalid plan. Use: monthly, yearly, or lifetime" });
    }

    const userId = authUser.id;
    const userEmail = authUser.email || "";

    // Build server-side success URL that will verify and redirect to extension
    const returnUrl = successUrl || "";
    const serverSuccessUrl = `https://engine.chessr.io/api/polar/success?checkout_id={CHECKOUT_ID}&return=${encodeURIComponent(returnUrl)}`;

    console.log(`[Polar] Creating checkout: user=${userId}, email=${userEmail}, plan=${plan}`);

    const checkout = await polar.checkouts.create({
      products: [productId],
      customerEmail: userEmail,
      externalCustomerId: userId,
      successUrl: serverSuccessUrl,
      discountId: "dc25a21f-075a-4541-8459-de209a60b677",
    });

    console.log(`[Polar] Checkout created for ${userEmail} → ${plan}`);

    json(res, 200, { url: checkout.url });
  } catch (err) {
    console.error("[Polar] Checkout error:", err);
    json(res, 500, { error: "Internal error" });
  }
}

// ─── Checkout success redirect ───────────────────────────────────────────────
// GET /api/polar/success?checkout_id=xxx&return=xxx — verify checkout, redirect to extension

export async function handlePolarSuccess(req: IncomingMessage, res: ServerResponse) {
  try {
    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const checkoutId = urlObj.searchParams.get("checkout_id");
    const returnUrl = urlObj.searchParams.get("return") || "";

    if (checkoutId) {
      try {
        const checkout = await polar.checkouts.get({ id: checkoutId });
        console.log(`[Polar] Success verified: checkout=${checkoutId}, status=${checkout.status}`);
      } catch (err) {
        console.error(`[Polar] Failed to verify checkout ${checkoutId}:`, err);
      }
    }

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
    console.error("[Polar] Success redirect error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong");
  }
}

// ─── Cancel subscription endpoint ────────────────────────────────────────────

export async function handlePolarCancel(req: IncomingMessage, res: ServerResponse) {
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
      .select("polar_subscription_id, plan, interval")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (!sub?.polar_subscription_id) {
      return json(res, 400, { error: "No active subscription found" });
    }

    // Cancel at end of billing period via Polar API
    await polar.subscriptions.update({
      id: sub.polar_subscription_id,
      subscriptionUpdate: { cancelAtPeriodEnd: true },
    });

    console.log(`[Polar] Cancel requested by ${userEmail} (${sub.polar_subscription_id}), reason: ${reason || "none"}`);

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
    console.error("[Polar] Cancel error:", err);
    json(res, 500, { error: "Failed to cancel subscription" });
  }
}

// ─── Customer portal endpoint ────────────────────────────────────────────────
// POST /api/polar/portal — creates a Polar customer portal session, returns URL

export async function handlePolarPortal(req: IncomingMessage, res: ServerResponse) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return json(res, 401, { error: "Authentication required" });

    const session = await polar.customerSessions.create({
      externalCustomerId: authUser.id,
    });

    console.log(`[Polar] Portal session created for ${authUser.email}`);

    json(res, 200, { url: session.customerPortalUrl });
  } catch (err) {
    console.error("[Polar] Portal error:", err);
    json(res, 500, { error: "Failed to create portal session" });
  }
}

// ─── Subscription status endpoint ────────────────────────────────────────────

export async function handlePolarSubscriptionStatus(req: IncomingMessage, res: ServerResponse) {
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
    console.error("[Polar] Status error:", err);
    json(res, 500, { error: "Internal error" });
  }
}
