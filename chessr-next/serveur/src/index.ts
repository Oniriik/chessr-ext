import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import {
  initEnginePool,
  handleSuggestionRequest,
  handleUserDisconnect,
  shutdownEnginePool,
  getStats,
  type Client,
  type SuggestionMessage,
} from "./handlers/suggestionHandler.js";
import { logActivity } from "./utils/activityLogger.js";
import {
  initStockfishPool,
  handleAnalysisRequest,
  handleAnalysisDisconnect,
  shutdownStockfishPool,
  getAnalysisStats,
  type AnalysisMessage,
} from "./handlers/analysisHandler.js";
import {
  handleGetLinkedAccounts,
  handleLinkAccount,
  handleUnlinkAccount,
  handleCheckCooldown,
  type LinkAccountMessage,
  type UnlinkAccountMessage,
  type CheckCooldownMessage,
} from "./handlers/accountHandler.js";
import {
  handleOpeningRequest,
  getOpeningStats,
  type OpeningMessage,
} from "./handlers/openingHandler.js";
import {
  handleInitDiscordLink,
  handleDiscordCallback,
  handleDiscordLinkHttp,
  handleUnlinkDiscord,
  type InitDiscordLinkMessage,
} from "./handlers/discordHandler.js";
import { handleExplainMove } from "./handlers/explanationHandler.js";
import {
  handlePaddleWebhook,
  handlePaddleCheckout,
  handlePaddleCancel,
  handlePaddleSwitch,
  handlePaddlePreviewUpgrade,
  handlePaddleUpgradeLifetime,
  handlePaddleSubscriptionStatus,
  handlePaddlePrices,
  handlePaddleBillingLink,
  handlePaddleCheckoutByToken,
  handleStatusByToken,
  handleSwitchByToken,
  handleCancelByToken,
  handlePreviewUpgradeByToken,
  handleUpgradeLifetimeByToken,
} from "./handlers/paddleHandler.js";
import { logConnection } from "./utils/logger.js";

const PORT = parseInt(process.env.PORT || "8080");
const MAX_KOMODO_INSTANCES = parseInt(process.env.MAX_KOMODO_INSTANCES || "2");
const MAX_STOCKFISH_INSTANCES = parseInt(
  process.env.MAX_STOCKFISH_INSTANCES || "1",
);

// Version info for extension update checks
const VERSION_INFO = {
  minVersion: "2.4.1",
  downloadUrl: "https://download.chessr.io",
};

// Initialize Supabase client with service role key for token verification
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// Store authenticated connections
const clients = new Map<string, Client>();

// Heartbeat: ping clients every 30s, disconnect if no pong within 10s
const HEARTBEAT_INTERVAL = 30_000;
const clientAlive = new Map<string, boolean>();

setInterval(() => {
  for (const [userId, client] of clients) {
    if (!clientAlive.get(userId)) {
      // No pong received since last ping — dead connection
      console.log(`[Heartbeat] No pong from ${userId}, terminating`);
      client.ws.terminate();
      continue;
    }
    clientAlive.set(userId, false);
    client.ws.ping();
  }
}, HEARTBEAT_INTERVAL);

// Cache of user+ip pairs already stored (avoid repeated DB checks)
const storedIpPairs = new Set<string>();

// Ban status cache (TTL 60s to avoid DB call on every message)
const BAN_CACHE_TTL = 60_000;
const banCache = new Map<
  string,
  { banned: boolean; reason: string | null; checkedAt: number }
>();

// Maintenance schedule cache (refreshed every 60s)
let maintenanceStart: number = 0; // Unix epoch seconds, 0 = none
let maintenanceEnd: number = 0;
let maintenanceLastChecked: number = 0;

async function getMaintenanceSchedule(): Promise<{ start: number; end: number }> {
  if (Date.now() - maintenanceLastChecked < BAN_CACHE_TTL) {
    return { start: maintenanceStart, end: maintenanceEnd };
  }
  try {
    const { data } = await supabase
      .from("global_stats")
      .select("key, value")
      .in("key", ["maintenance_schedule", "maintenance_schedule_end"]);
    maintenanceStart = Number(data?.find((r: { key: string }) => r.key === "maintenance_schedule")?.value || 0);
    maintenanceEnd = Number(data?.find((r: { key: string }) => r.key === "maintenance_schedule_end")?.value || 0);
    maintenanceLastChecked = Date.now();
  } catch {
    // keep last known values
  }
  return { start: maintenanceStart, end: maintenanceEnd };
}

// Discord Bot API for notifications
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_NOTIFICATION_CHANNEL_ID = process.env.DISCORD_CHANNEL_ADMIN || process.env.DISCORD_NOTIFICATION_CHANNEL_ID;

async function checkBanStatus(
  userId: string,
): Promise<{ banned: boolean; reason: string | null }> {
  const cached = banCache.get(userId);
  if (cached && Date.now() - cached.checkedAt < BAN_CACHE_TTL) {
    return { banned: cached.banned, reason: cached.reason };
  }

  try {
    const { data } = await supabase
      .from("user_settings")
      .select("banned, ban_reason")
      .eq("user_id", userId)
      .single();

    const result = {
      banned: data?.banned === true,
      reason: data?.ban_reason || null,
    };
    banCache.set(userId, { ...result, checkedAt: Date.now() });
    return result;
  } catch {
    return { banned: false, reason: null };
  }
}

// Resolve IP to country (reusable helper)
async function resolveIpCountry(
  ip: string,
): Promise<{ country: string | null; countryCode: string | null }> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode`,
    );
    if (res.ok) {
      const data = await res.json();
      if (data.status === "success") {
        return { country: data.country, countryCode: data.countryCode };
      }
    }
  } catch {
    // ignore
  }
  return { country: null, countryCode: null };
}

// Clean an IP (normalize IPv6-mapped IPv4, return null for private IPs)
function cleanIpAddress(ip: string | null): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, "");
  if (
    clean === "127.0.0.1" ||
    clean === "::1" ||
    clean.startsWith("10.") ||
    clean.startsWith("172.") ||
    clean.startsWith("192.168.")
  ) {
    return null;
  }
  return clean;
}

// Store user IP and resolve country via geolocation
// Stores every unique IP per user (useful for freetrial abuse detection)
async function storeUserIp(userId: string, ip: string | null) {
  const cleanIp = cleanIpAddress(ip);
  if (!cleanIp) return;

  const pairKey = `${userId}:${cleanIp}`;
  if (storedIpPairs.has(pairKey)) return;

  try {
    // Check if this exact user+ip combo already exists
    const { data: existing } = await supabase
      .from("signup_ips")
      .select("id")
      .eq("user_id", userId)
      .eq("ip_address", cleanIp)
      .limit(1);

    if (existing && existing.length > 0) {
      storedIpPairs.add(pairKey);
      return;
    }

    const { country, countryCode } = await resolveIpCountry(cleanIp);

    // Store in DB
    const { error } = await supabase.from("signup_ips").insert({
      user_id: userId,
      ip_address: cleanIp,
      country,
      country_code: countryCode,
    });

    if (error) {
      console.error("[IP] Failed to store:", error.message);
    } else {
      storedIpPairs.add(pairKey);
      console.log(
        `[IP] Stored for ${userId}: ${cleanIp} -> ${country || "unknown"}`,
      );
    }
  } catch (e) {
    console.error("[IP] Error:", e);
  }
}

// Send Discord notification for blocked signup attempts via Bot API
async function reportBlockedSignup(
  email: string,
  ip: string | null,
): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFICATION_CHANNEL_ID) return;

  const cleanIp = cleanIpAddress(ip);
  let countryText = "Unknown";

  if (cleanIp) {
    const { country } = await resolveIpCountry(cleanIp);
    if (country) countryText = country;
  }

  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_NOTIFICATION_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        embeds: [
          {
            title: "\u26a0\ufe0f Blocked Signup Attempt",
            color: 0xef4444,
            fields: [
              { name: "\ud83d\udce7 Email", value: email, inline: true },
              {
                name: "\ud83c\udf0d Country",
                value: countryText,
                inline: true,
              },
              {
                name: "\ud83d\udd12 IP",
                value: cleanIp || "Unknown",
                inline: true,
              },
            ],
            timestamp: new Date().toISOString(),
            footer: {
              text: "Chessr.io",
              icon_url: "https://chessr.io/chessr-logo.png",
            },
          },
        ],
      }),
    });
  } catch (e) {
    console.error("[Discord] Failed to send blocked signup notification:", e);
  }
}

// =============================================================================
// HTTP Server for version endpoint
// =============================================================================
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Report blocked signup attempt (disposable email)
  if (req.url === "/report-blocked-signup" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Email required" }));
          return;
        }

        const clientIp =
          (req.headers["x-forwarded-for"] as string)
            ?.split(",")[0]
            ?.trim() ||
          req.socket.remoteAddress ||
          null;

        console.log(
          `[Blocked] Disposable email attempt: ${email} from ${clientIp}`,
        );
        reportBlockedSignup(email, clientIp);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // Version endpoint
  if (req.url === "/version" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(VERSION_INFO));
    return;
  }

  // Discord OAuth callback
  if (req.url?.startsWith("/discord/callback") && req.method === "GET") {
    handleDiscordCallback(req, res);
    return;
  }

  // Discord link (HTTP — for billing page)
  if (req.url === "/api/discord/link" && req.method === "POST") {
    handleDiscordLinkHttp(req, res);
    return;
  }

  // Stats endpoint for admin dashboard
  if (req.url === "/stats" && req.method === "GET") {
    const suggestionStats = getStats();
    const analysisStats = getAnalysisStats();
    const openingStats = getOpeningStats();

    // Get list of connected users
    const connectedUsersList = Array.from(clients.values()).map((client) => ({
      id: client.user.id,
      email: client.user.email,
      engine: client.engine || 'default',
    }));

    const stats = {
      realtime: {
        connectedUsers: clients.size,
        connectedClients: wss.clients.size,
        users: connectedUsersList,
      },
      queues: {
        suggestion: suggestionStats.queue,
        analysis: analysisStats.queue,
      },
      pools: {
        komodo: suggestionStats.pool,
        stockfish: analysisStats.pool,
      },
      opening: openingStats,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return;
  }

  // Move explanation endpoint (proxies LLM call, keeps API key server-side)
  if (req.url === "/api/explain-move" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", async () => {
      try {
        // Verify auth token
        const authHeader = req.headers["authorization"];
        const token = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;

        if (!token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Authentication required" }));
          return;
        }

        const { data: authData, error: authError } =
          await supabase.auth.getUser(token);

        if (authError || !authData.user) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid token" }));
          return;
        }

        const userId = authData.user.id;

        // Premium check (server-side, authoritative)
        const { data: settings } = await supabase
          .from("user_settings")
          .select("plan")
          .eq("user_id", userId)
          .single();

        const plan = settings?.plan || "free";
        const premiumPlans = ["premium", "lifetime", "beta", "freetrial"];
        if (!premiumPlans.includes(plan)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Premium feature" }));
          return;
        }

        // Daily limit check (50/day, resets at midnight UTC)
        const DAILY_LIMIT = 50;
        const todayUTC = new Date();
        todayUTC.setUTCHours(0, 0, 0, 0);

        const { count: dailyCount } = await supabase
          .from("user_activity")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("event_type", "explanation")
          .gte("created_at", todayUTC.toISOString());

        const currentUsage = dailyCount || 0;
        if (currentUsage >= DAILY_LIMIT) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Daily limit reached",
              dailyUsage: DAILY_LIMIT,
              dailyLimit: DAILY_LIMIT,
            }),
          );
          return;
        }

        const params = JSON.parse(body);
        console.log(
          `[Explain] ${authData.user.email} → ${params.moveSan} (${params.isMaia ? "Maia" : "Komodo"}) [${currentUsage + 1}/${DAILY_LIMIT}]`,
        );

        const explanation = await handleExplainMove(params);

        // Log usage
        await supabase.from("user_activity").insert({
          user_id: userId,
          event_type: "explanation",
        });
        await supabase.rpc("increment_stat", { stat_key: "total_explanations" });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            explanation,
            dailyUsage: currentUsage + 1,
            dailyLimit: DAILY_LIMIT,
          }),
        );
      } catch (err) {
        console.error("[Explain] Error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              err instanceof Error ? err.message : "Failed to generate explanation",
          }),
        );
      }
    });
    return;
  }

  // Explanation usage endpoint (returns daily quota for authenticated user)
  if (req.url === "/api/explanation-usage" && req.method === "GET") {
    (async () => {
      try {
        const authHeader = req.headers["authorization"];
        const token = authHeader?.startsWith("Bearer ")
          ? authHeader.slice(7)
          : null;

        if (!token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Authentication required" }));
          return;
        }

        const { data: authData, error: authError } =
          await supabase.auth.getUser(token);

        if (authError || !authData.user) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid token" }));
          return;
        }

        const userId = authData.user.id;

        // Check plan
        const { data: settings } = await supabase
          .from("user_settings")
          .select("plan")
          .eq("user_id", userId)
          .single();

        const plan = settings?.plan || "free";
        const premiumPlans = ["premium", "lifetime", "beta", "freetrial"];
        if (!premiumPlans.includes(plan)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ dailyUsage: 0, dailyLimit: 0, isPremium: false }),
          );
          return;
        }

        const DAILY_LIMIT = 50;
        const todayUTC = new Date();
        todayUTC.setUTCHours(0, 0, 0, 0);

        const { count } = await supabase
          .from("user_activity")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("event_type", "explanation")
          .gte("created_at", todayUTC.toISOString());

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            dailyUsage: count || 0,
            dailyLimit: DAILY_LIMIT,
            isPremium: true,
          }),
        );
      } catch (err) {
        console.error("[ExplanationUsage] Error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    })();
    return;
  }

  // Paddle checkout page (loads Paddle.js and opens checkout overlay)
  if (req.url?.startsWith("/checkout") && req.method === "GET") {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const txnId = urlObj.searchParams.get("txn");

    if (!txnId) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing txn parameter");
      return;
    }

    const paddleEnv = process.env.PADDLE_ENVIRONMENT || "sandbox";
    const paddleJs = paddleEnv === "sandbox"
      ? "https://sandbox-cdn.paddle.com/paddle/v2/paddle.js"
      : "https://cdn.paddle.com/paddle/v2/paddle.js";
    const clientToken = process.env.PADDLE_CLIENT_TOKEN || "";

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chessr — Checkout</title>
  <script src="${paddleJs}"><\/script>
  <style>
    body { margin: 0; background: #08080f; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .loading { text-align: center; }
    .loading p { color: rgba(255,255,255,0.5); font-size: 14px; margin-top: 16px; }
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <p>Opening checkout...</p>
  </div>
  <script>
    Paddle.Initialize({
      token: "${clientToken}",
      ${paddleEnv === "sandbox" ? 'environment: "sandbox",' : ""}
      checkout: {
        settings: {
          successUrl: "https://chessr.io/checkout/success",
          theme: "dark"
        }
      }
    });
    Paddle.Checkout.open({
      transactionId: "${txnId}"
    });
  <\/script>
</body>
</html>`);
    return;
  }

  // Paddle webhook
  if (req.url === "/api/paddle/webhook" && req.method === "POST") {
    handlePaddleWebhook(req, res);
    return;
  }

  // Paddle billing link (get signed token for chessr.io/checkout)
  if (req.url === "/api/paddle/billing-link" && req.method === "POST") {
    handlePaddleBillingLink(req, res);
    return;
  }

  // Paddle checkout by token (from chessr.io/checkout plan selection)
  if (req.url === "/api/paddle/checkout-by-token" && req.method === "POST") {
    handlePaddleCheckoutByToken(req, res);
    return;
  }

  // Paddle status by token (subscription info for chessr.io billing page)
  if (req.url === "/api/paddle/status-by-token" && req.method === "POST") {
    handleStatusByToken(req, res);
    return;
  }

  // Paddle switch by token
  if (req.url === "/api/paddle/switch-by-token" && req.method === "POST") {
    handleSwitchByToken(req, res);
    return;
  }

  // Paddle cancel by token
  if (req.url === "/api/paddle/cancel-by-token" && req.method === "POST") {
    handleCancelByToken(req, res);
    return;
  }

  // Paddle preview upgrade by token
  if (req.url === "/api/paddle/preview-upgrade-by-token" && req.method === "POST") {
    handlePreviewUpgradeByToken(req, res);
    return;
  }

  // Paddle upgrade lifetime by token
  if (req.url === "/api/paddle/upgrade-lifetime-by-token" && req.method === "POST") {
    handleUpgradeLifetimeByToken(req, res);
    return;
  }

  // Paddle checkout (link user ↔ customer)
  if (req.url === "/api/paddle/checkout" && req.method === "POST") {
    handlePaddleCheckout(req, res);
    return;
  }

  // Paddle preview upgrade (proration breakdown for yearly or lifetime)
  if (req.url === "/api/paddle/preview-upgrade" && req.method === "POST") {
    handlePaddlePreviewUpgrade(req, res);
    return;
  }

  // Paddle switch plan (monthly ↔ yearly)
  if (req.url === "/api/paddle/switch" && req.method === "POST") {
    handlePaddleSwitch(req, res);
    return;
  }

  // Paddle upgrade to lifetime
  if (req.url === "/api/paddle/upgrade-lifetime" && req.method === "POST") {
    handlePaddleUpgradeLifetime(req, res);
    return;
  }

  // Paddle cancel subscription
  if (req.url === "/api/paddle/cancel" && req.method === "POST") {
    handlePaddleCancel(req, res);
    return;
  }

  // Paddle subscription status
  if (req.url === "/api/paddle/subscription" && req.method === "GET") {
    handlePaddleSubscriptionStatus(req, res);
    return;
  }

  // Paddle localized prices
  if (req.url === "/api/paddle/prices" && req.method === "GET") {
    handlePaddlePrices(req, res);
    return;
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// =============================================================================
// WebSocket Server (attached to HTTP server)
// =============================================================================

// Create WebSocket server attached to HTTP server (same port)
const wss = new WebSocketServer({ server: httpServer });

// Initialize engine pools (Komodo for suggestions, Stockfish for analysis)
initEnginePool(MAX_KOMODO_INSTANCES).catch((err) => {
  console.error("Failed to initialize Komodo pool:", err);
  process.exit(1);
});

initStockfishPool(MAX_STOCKFISH_INSTANCES).catch((err) => {
  console.error("Failed to initialize Stockfish pool:", err);
  process.exit(1);
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  // Extract client IP from headers (reverse proxy) or socket
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null;

  let userId: string | null = null;
  let isAuthenticated = false;

  // Set a timeout for authentication (10 seconds)
  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) {
      console.log("Authentication timeout, closing connection");
      ws.close(4001, "Authentication timeout");
    }
  }, 10000);

  ws.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle authentication
      if (message.type === "auth") {
        const token = message.token;

        if (!token) {
          ws.send(
            JSON.stringify({ type: "auth_error", error: "No token provided" }),
          );
          ws.close(4002, "No token provided");
          return;
        }

        // Verify the token with Supabase
        const { data: authData, error } = await supabase.auth.getUser(token);

        if (error || !authData.user) {
          console.log(
            "Authentication failed:",
            error?.message || "Invalid token",
          );
          ws.send(
            JSON.stringify({ type: "auth_error", error: "Invalid token" }),
          );
          ws.close(4003, "Invalid token");
          return;
        }

        const user = authData.user;

        // Authentication successful
        clearTimeout(authTimeout);
        isAuthenticated = true;
        userId = user.id;

        // Store the connection
        clients.set(userId, {
          ws,
          user: { id: user.id, email: user.email || "" },
        });
        clientAlive.set(userId, true);

        // Store IP and resolve country (fire and forget)
        storeUserIp(user.id, clientIp);

        logConnection(user.email || userId, 'connected');

        // Get maintenance schedule and Discord status for the client
        const maintenance = await getMaintenanceSchedule();

        const { data: userSettings } = await supabase
          .from("user_settings")
          .select("discord_id, discord_username, discord_avatar, freetrial_used, discord_in_guild")
          .eq("user_id", user.id)
          .single();

        ws.send(
          JSON.stringify({
            type: "auth_success",
            user: {
              id: user.id,
              email: user.email,
            },
            maintenanceSchedule: maintenance.start > 0 ? maintenance : null,
            discordLinked: !!userSettings?.discord_id,
            discordUsername: userSettings?.discord_username || null,
            discordAvatar: userSettings?.discord_avatar || null,
            freetrialUsed: userSettings?.freetrial_used || false,
            discordInGuild: userSettings?.discord_in_guild || false,
          }),
        );
        return;
      }

      // All other messages require authentication
      if (!isAuthenticated || !userId) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      // Check ban status before processing requests
      if (
        message.type === "suggestion" ||
        message.type === "analyze"
      ) {
        const banStatus = await checkBanStatus(userId);
        if (banStatus.banned) {
          ws.send(
            JSON.stringify({
              type: "banned",
              reason: banStatus.reason || "Your account has been banned.",
            }),
          );
          ws.close(4010, "Banned");
          return;
        }
      }

      // Get client (may be undefined if disconnected during message processing)
      const client = clients.get(userId);
      if (!client) {
        console.log(`[WS] Ignoring message from disconnected user ${userId}`);
        return;
      }

      // Handle message types
      switch (message.type) {
        case "suggestion":
          handleSuggestionRequest(
            message as SuggestionMessage,
            client,
          );
          break;

        case "analyze":
          handleAnalysisRequest(
            message as AnalysisMessage,
            client,
          );
          break;

        case "get_linked_accounts":
          handleGetLinkedAccounts(client);
          break;

        case "link_account":
          handleLinkAccount(
            message as LinkAccountMessage,
            client,
          );
          break;

        case "unlink_account":
          handleUnlinkAccount(
            message as UnlinkAccountMessage,
            client,
          );
          break;

        case "check_cooldown":
          handleCheckCooldown(
            message as CheckCooldownMessage,
            client,
          );
          break;

        case "get_opening":
          handleOpeningRequest(
            message as OpeningMessage,
            client,
          );
          break;

        case "init_discord_link":
          handleInitDiscordLink(
            message as InitDiscordLinkMessage,
            client,
          );
          break;

        case "unlink_discord":
          handleUnlinkDiscord(client);
          break;

        case "engine_update":
          client.engine = message.engine || 'default';
          break;

        case "log_maia_suggestion":
          logActivity(userId, "maia_suggestion");
          break;

        default:
          console.log(`Unknown message type from ${userId}:`, message.type);
          ws.send(
            JSON.stringify({ type: "error", error: "Unknown message type" }),
          );
      }
    } catch (err) {
      console.error("Error processing message:", err);
      ws.send(
        JSON.stringify({ type: "error", error: "Invalid message format" }),
      );
    }
  });

  ws.on("pong", () => {
    if (userId) clientAlive.set(userId, true);
  });

  ws.on("close", () => {
    clearTimeout(authTimeout);
    if (userId) {
      const client = clients.get(userId);
      // Cancel any pending requests for this user
      handleUserDisconnect(userId);
      handleAnalysisDisconnect(userId);
      clients.delete(userId);
      clientAlive.delete(userId);
      logConnection(client?.user.email || userId, 'disconnected');
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
  });
});

wss.on("listening", () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down...");
  await Promise.all([shutdownEnginePool(), shutdownStockfishPool()]);
  httpServer.close();
  wss.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
