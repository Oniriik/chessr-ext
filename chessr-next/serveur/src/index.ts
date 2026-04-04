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
import { handleChesscomReview } from "./handlers/chesscomReviewHandler.js";
import {
  handleProfileAnalysis,
  handleProfileAnalysisSubscribe,
  handleProfileAnalysisDisconnect,
  type ProfileAnalysisStartMessage,
  type ProfileAnalysisSubscribeMessage,
} from "./handlers/profileAnalysisHandler.js";
import {
  handleGetLinkedAccounts,
  handleLinkAccount,
  handleUnlinkAccount,
  type LinkAccountMessage,
  type UnlinkAccountMessage,
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
import { logConnection, logStart } from "./utils/logger.js";
import { resolveUserBetas } from "./betaFlags.js";

const PORT = parseInt(process.env.PORT || "8080");
const MAX_KOMODO_INSTANCES = parseInt(process.env.MAX_KOMODO_INSTANCES || "2");
const MAX_STOCKFISH_INSTANCES = parseInt(
  process.env.MAX_STOCKFISH_INSTANCES || "1",
);

// Version info for extension update checks
const VERSION_INFO = {
  minVersion: "2.4.3",
  downloadUrl: "https://download.chessr.io",
};

// Initialize Supabase client with service role key for token verification
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// Store authenticated connections
const clients = new Map<string, Client>();

// Heartbeat: ping clients every 10min, disconnect if no pong
const HEARTBEAT_INTERVAL = 600_000;
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

// Dedup set for signup reports (avoid double Discord notifications)
const reportedSignups = new Set<string>();

// Cache of user+fingerprint pairs already stored
const storedFpPairs = new Set<string>();

async function storeFingerprint(userId: string, fingerprint: string | null) {
  if (!fingerprint) return;
  const pairKey = `${userId}:${fingerprint}`;
  if (storedFpPairs.has(pairKey)) return;

  try {
    await supabase
      .from("user_fingerprints")
      .upsert(
        { user_id: userId, fingerprint },
        { onConflict: "user_id,fingerprint" },
      );
    storedFpPairs.add(pairKey);
  } catch {
    // ignore duplicates
  }
}

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
const DISCORD_NOTIFICATION_CHANNEL_ID = process.env.DISCORD_CHANNEL_ADMIN || process.env.DISCORD_NOTIFICATION_CHANNEL_ID || "1477490743588159488";
const DISCORD_SIGNUP_CHANNEL_ID = process.env.DISCORD_CHANNEL_SIGNUP || "1476547865039077416";

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

  // Check signup: block if fingerprint or IP already belongs to another user
  if (req.url === "/check-signup" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { fingerprint, email } = JSON.parse(body);

        const clientIp =
          (req.headers["x-forwarded-for"] as string)
            ?.split(",")[0]
            ?.trim() ||
          req.socket.remoteAddress ||
          null;
        const cleanIp = cleanIpAddress(clientIp);

        // Check 1: fingerprint match (priority)
        let blocked = false;
        let reason = "";
        let matchedUserIds: string[] = [];

        if (fingerprint) {
          const { data: fpMatches } = await supabase
            .from("user_fingerprints")
            .select("user_id")
            .eq("fingerprint", fingerprint);

          if (fpMatches && fpMatches.length > 0) {
            blocked = true;
            reason = "Shared Fingerprint";
            matchedUserIds = fpMatches.map(r => r.user_id);
          }
        }

        // Check 2: IP match (fallback if no fingerprint match)
        if (!blocked && cleanIp) {
          const { data: ipMatches } = await supabase
            .from("signup_ips")
            .select("user_id")
            .eq("ip_address", cleanIp);

          if (ipMatches && ipMatches.length > 0) {
            blocked = true;
            reason = "Shared IP";
            matchedUserIds = ipMatches.map(r => r.user_id);
          }
        }

        if (blocked) {
          // Send Discord notification (fire-and-forget)
          (async () => {
            try {
              if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFICATION_CHANNEL_ID) return;

              const { country } = cleanIp ? await resolveIpCountry(cleanIp) : { country: null };

              // Fetch associated accounts
              const uniqueUserIds = [...new Set(matchedUserIds)];
              let linkedAccountsText = "";
              if (uniqueUserIds.length > 0) {
                const { data: settings } = await supabase
                  .from("user_settings")
                  .select("user_id, plan")
                  .in("user_id", uniqueUserIds);
                const accounts: string[] = [];
                for (const s of settings || []) {
                  const { data: authData } = await supabase.auth.admin.getUserById(s.user_id);
                  accounts.push(`${authData?.user?.email || s.user_id} (${s.plan})`);
                }
                linkedAccountsText = accounts.join("\n");
              }

              const fields = [
                { name: "📧 Email", value: email || "unknown", inline: true },
                { name: "🔑 Reason", value: reason, inline: true },
                { name: "🌍 Country", value: country || "Unknown", inline: true },
              ];
              if (fingerprint) fields.push({ name: "🖥️ Fingerprint", value: `\`${fingerprint}\``, inline: false });
              if (cleanIp) fields.push({ name: "🔒 IP", value: cleanIp, inline: true });
              if (linkedAccountsText) fields.push({ name: "⚠️ Linked Accounts", value: linkedAccountsText, inline: false });

              await fetch(`https://discord.com/api/v10/channels/${DISCORD_NOTIFICATION_CHANNEL_ID}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
                body: JSON.stringify({
                  embeds: [{
                    title: "🚫 Signup Blocked — Multi-Account",
                    color: 0xef4444,
                    fields,
                    timestamp: new Date().toISOString(),
                    footer: { text: "Chessr.io", icon_url: "https://chessr.io/chessr-logo.png" },
                  }],
                }),
              });
            } catch (e) {
              console.error("[Discord] Failed to send blocked signup notification:", e);
            }
          })();

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ allowed: false }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ allowed: true }));
      } catch {
        // On error, allow signup (don't block legitimate users)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ allowed: true }));
      }
    });
    return;
  }

  // Report banned login attempt
  if (req.url === "/report-banned-login" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { email, banReason } = JSON.parse(body);
        if (!DISCORD_BOT_TOKEN || !DISCORD_NOTIFICATION_CHANNEL_ID) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        const clientIp =
          (req.headers["x-forwarded-for"] as string)
            ?.split(",")[0]
            ?.trim() ||
          req.socket.remoteAddress ||
          null;
        const cleanIp = cleanIpAddress(clientIp);
        const { country } = cleanIp ? await resolveIpCountry(cleanIp) : { country: null };

        const fields = [
          { name: "📧 Email", value: email || "unknown", inline: true },
          { name: "📛 Ban Reason", value: banReason || "No reason", inline: true },
          { name: "🌍 Country", value: country || "Unknown", inline: true },
        ];
        if (cleanIp) fields.push({ name: "🔒 IP", value: cleanIp, inline: true });

        await fetch(`https://discord.com/api/v10/channels/${DISCORD_NOTIFICATION_CHANNEL_ID}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
          body: JSON.stringify({
            embeds: [{
              title: "🔒 Banned Login Attempt",
              color: 0xef4444,
              fields,
              timestamp: new Date().toISOString(),
              footer: { text: "Chessr.io", icon_url: "https://chessr.io/chessr-logo.png" },
            }],
          }),
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }

  // Report signup: resolve country from IP and store in user_settings
  if (req.url === "/report-signup" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { userId, email, fingerprint } = JSON.parse(body);
        if (!userId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "userId required" }));
          return;
        }

        // Dedup: skip if already processed this userId
        if (reportedSignups.has(userId)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        reportedSignups.add(userId);

        const clientIp =
          (req.headers["x-forwarded-for"] as string)
            ?.split(",")[0]
            ?.trim() ||
          req.socket.remoteAddress ||
          null;

        const cleanIp = cleanIpAddress(clientIp);
        let country: string | null = null;
        let countryCode: string | null = null;

        if (cleanIp) {
          const geo = await resolveIpCountry(cleanIp);
          country = geo.country;
          countryCode = geo.countryCode;
        }

        // Update user_settings with country
        if (country) {
          await supabase
            .from("user_settings")
            .update({ signup_country: country, signup_country_code: countryCode })
            .eq("user_id", userId);
        }

        // Check for other accounts BEFORE storing (avoids self-match)
        // Check for other accounts with the same IP or fingerprint
        const otherUserIds = new Set<string>();
        if (cleanIp) {
          const { data: sameIpUsers } = await supabase
            .from("signup_ips")
            .select("user_id")
            .eq("ip_address", cleanIp)
            .neq("user_id", userId);
          for (const r of sameIpUsers || []) otherUserIds.add(r.user_id);
        }
        if (fingerprint) {
          const { data: sameFpUsers } = await supabase
            .from("user_fingerprints")
            .select("user_id")
            .eq("fingerprint", fingerprint)
            .neq("user_id", userId);
          for (const r of sameFpUsers || []) otherUserIds.add(r.user_id);
        }

        let otherAccountsText: string | null = null;
        if (otherUserIds.size > 0) {
          const { data: otherSettings } = await supabase
            .from("user_settings")
            .select("user_id, plan")
            .in("user_id", [...otherUserIds]);

          const otherAccounts: string[] = [];
          for (const settings of otherSettings || []) {
            const { data: authData } = await supabase.auth.admin.getUserById(settings.user_id);
            const otherEmail = authData?.user?.email || settings.user_id;
            otherAccounts.push(`${otherEmail} (${settings.plan})`);
          }
          if (otherAccounts.length) {
            otherAccountsText = otherAccounts.join("\n");
          }
        }

        // Store IP and fingerprint AFTER the check to avoid self-match
        storeUserIp(userId, clientIp);
        storeFingerprint(userId, fingerprint);

        // Send Discord signup notification
        if (DISCORD_BOT_TOKEN && DISCORD_SIGNUP_CHANNEL_ID) {
          const fields = [
            { name: "📧 Email", value: email || "unknown", inline: true },
            { name: "🌍 Country", value: country || "Unknown", inline: true },
            { name: "🔑 IP", value: cleanIp || "Unknown", inline: true },
          ];
          if (fingerprint) {
            fields.push({ name: "🖥️ Fingerprint", value: `\`${fingerprint}\``, inline: false });
          }
          if (otherAccountsText) {
            fields.push({ name: "⚠️ Other accounts (same IP/fingerprint)", value: otherAccountsText, inline: false });
          }
          fetch(`https://discord.com/api/v10/channels/${DISCORD_SIGNUP_CHANNEL_ID}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bot ${DISCORD_BOT_TOKEN}`,
            },
            body: JSON.stringify({
              embeds: [{
                title: "🎉 New User Signup",
                color: otherAccountsText ? 0xffa500 : 0x10b981,
                fields,
                timestamp: new Date().toISOString(),
                footer: { text: "Chessr.io", icon_url: "https://chessr.io/chessr-logo.png" },
              }],
            }),
          }).catch((e) => console.error("[Discord] Failed to send signup notification:", e));
        }

        console.log(`[Signup] ${email || userId} from ${country || "unknown"} (${cleanIp || "no IP"})`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
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
  if (req.url?.startsWith("/api/paddle/prices") && req.method === "GET") {
    handlePaddlePrices(req, res);
    return;
  }

  // Review page
  if (req.url?.startsWith("/review")) {
    const reviewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chessr - Game Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #0d0d1a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; min-height: 100vh; }
    #root { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 80vh; gap: 16px; }
    .progress-bar { width: 256px; height: 8px; background: #1e1e3a; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #3b82f6; border-radius: 4px; transition: width 0.3s; }
    .error { color: #f87171; text-align: center; padding: 40px; }
    h1 { font-size: 24px; font-weight: 700; color: #3b82f6; margin-bottom: 4px; }
    .subtitle { color: #9ca3af; font-size: 13px; }
    .card { background: #12122a; border: 1px solid #2a2a4a; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card-title { color: #9ca3af; font-size: 11px; text-transform: uppercase; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { color: #9ca3af; font-size: 11px; font-weight: 600; text-align: center; padding: 4px 8px; border-bottom: 1px solid #2a2a4a; }
    th:first-child { text-align: left; }
    td { padding: 4px 8px; text-align: center; font-size: 13px; }
    td:first-child { text-align: left; }
    .accuracy-big { font-size: 20px; font-weight: 700; }
    .summary { font-style: italic; color: #d1d5db; font-size: 13px; }
    .btn { display: block; width: 100%; padding: 12px; border-radius: 8px; background: #3b82f6; color: white; font-weight: 700; font-size: 15px; border: none; cursor: pointer; text-align: center; }
    .btn:hover { opacity: 0.9; }
    .cls-brilliant, .cls-great { color: #22d3ee; }
    .cls-best { color: #34d399; }
    .cls-excellent { color: #6ee7b7; }
    .cls-good { color: #e2e8f0; }
    .cls-book { color: #a78bfa; }
    .cls-inaccuracy { color: #fbbf24; }
    .cls-mistake { color: #fb923c; }
    .cls-miss { color: #ef4444; }
    .cls-blunder { color: #f87171; }
    /* Board */
    .board-container { display: flex; gap: 24px; flex-wrap: wrap; }
    .board-left { flex-shrink: 0; }
    .board-right { flex: 1; min-width: 280px; }
    .nav-buttons { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
    .nav-btn { width: 40px; height: 32px; border-radius: 4px; background: #1e1e3a; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: #e0e0e0; }
    .nav-btn:hover { background: #2a2a4a; }
    /* Coach card */
    .coach-card { border-radius: 8px; border: 1px solid #2a2a4a; overflow: hidden; margin-bottom: 12px; }
    .coach-header { padding: 12px 16px; display: flex; align-items: center; justify-content: between; }
    .coach-body { padding: 12px 16px; background: #12122a; }
    .coach-eval { background: #1e1e3a; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-weight: 700; font-size: 12px; margin-left: auto; }
    /* Move list */
    .move-list { max-height: 300px; overflow-y: auto; padding: 8px; }
    .move-row { display: grid; grid-template-columns: 32px 1fr 1fr; gap: 2px; font-size: 12px; }
    .move-num { color: #9ca3af; text-align: right; padding-right: 4px; line-height: 24px; }
    .move-cell { padding: 2px 6px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px; line-height: 20px; }
    .move-cell:hover { background: #1e1e3a; }
    .move-cell.active { background: rgba(59, 130, 246, 0.2); }
    .move-cls { font-weight: 700; font-size: 10px; width: 14px; }
    .move-san { font-family: monospace; }
    .follow-up { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .follow-up span { background: #1e1e3a; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; }
  </style>
</head>
<body>
  <div id="root"><div class="loading"><div style="font-size:20px;font-weight:700">Loading...</div></div></div>
  <script>
    const WS_URL = location.protocol === 'https:' ? 'wss://' + location.host : 'ws://' + location.host;
    const params = new URLSearchParams(location.search);
    const gameId = params.get('gameId');
    const gameType = params.get('gameType') || 'live';

    if (!gameId) {
      document.getElementById('root').innerHTML = '<div class="error"><h2>Missing game ID</h2><p>Usage: /review?gameId=123456</p></div>';
    } else {
      let analysis = null;
      let currentPly = 0;
      let view = 'loading';
      const root = document.getElementById('root');

      // Connect to WS
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'chesscom_review', requestId: 'r-' + gameId, gameId, gameType }));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'chesscom_review_progress') {
          root.innerHTML = '<div class="loading"><div style="font-size:20px;font-weight:700">Analyzing game...</div><div class="progress-bar"><div class="progress-fill" style="width:' + msg.progress + '%"></div></div><div style="color:#9ca3af">' + msg.progress + '%</div></div>';
        }
        if (msg.type === 'chesscom_review_result') {
          analysis = msg.analysis;
          view = 'summary';
          ws.close();
          render();
        }
        if (msg.type === 'chesscom_review_error') {
          root.innerHTML = '<div class="error"><h2>Error</h2><p>' + msg.error + '</p></div>';
          ws.close();
        }
      };
      ws.onerror = () => { root.innerHTML = '<div class="error"><h2>Connection failed</h2></div>'; };

      function getNames() {
        const opts = (analysis.options || []);
        const pgnJson = opts.find(o => o[0] === 'PgnHeadersJson');
        let h = {};
        try { h = JSON.parse(pgnJson?.[1] || '{}'); } catch {}
        const pgn = analysis.annotatedPgn || '';
        return {
          w: h.White || pgn.match(/\\[White "([^"]+)"\\]/)?.[1] || 'White',
          b: h.Black || pgn.match(/\\[Black "([^"]+)"\\]/)?.[1] || 'Black',
          wElo: h.WhiteElo || '', bElo: h.BlackElo || '',
          result: h.Result || '',
        };
      }

      function fmt(v) { return v != null ? v.toFixed(1) : '-'; }

      function render() {
        if (view === 'summary') renderSummary();
        else if (view === 'review') renderReview();
      }

      function renderSummary() {
        const n = getNames();
        const C = analysis.CAPS;
        const pos = analysis.positions || [];

        // Count classifications
        const wCls = {}, bCls = {};
        const clsOrder = ['brilliant','great','best','excellent','good','inaccuracy','mistake','miss','blunder'];
        const clsLabels = {brilliant:'Brilliant',great:'Great',best:'Best',excellent:'Excellent',good:'Good',inaccuracy:'Inaccuracy',mistake:'Mistake',miss:'Miss',blunder:'Blunder'};
        const clsColors = {brilliant:'cls-brilliant',great:'cls-great',best:'cls-best',excellent:'cls-excellent',good:'cls-good',inaccuracy:'cls-inaccuracy',mistake:'cls-mistake',miss:'cls-miss',blunder:'cls-blunder'};
        for (const p of pos) {
          if (!p.classificationName) continue;
          if (p.color === 'white') wCls[p.classificationName] = (wCls[p.classificationName]||0)+1;
          if (p.color === 'black') bCls[p.classificationName] = (bCls[p.classificationName]||0)+1;
        }

        let clsRows = '';
        for (const c of clsOrder) {
          const w = wCls[c]||0, b = bCls[c]||0;
          if (w||b) clsRows += '<tr><td><span class="'+clsColors[c]+'">'+(clsLabels[c])+'</span></td><td class="'+(w?clsColors[c]:'')+'">'+w+'</td><td class="'+(b?clsColors[c]:'')+'">'+b+'</td></tr>';
        }

        const pieces = ['K','Q','R','B','N','P'];
        const pieceNames = {K:'King',Q:'Queen',R:'Rook',B:'Bishop',N:'Knight',P:'Pawn'};
        let pieceRows = '';
        for (const p of pieces) {
          const w = C.white[p], b = C.black[p];
          if ((w&&w>0)||(b&&b>0)) pieceRows += '<tr><td>'+pieceNames[p]+'</td><td>'+fmt(w)+'</td><td>'+fmt(b)+'</td></tr>';
        }

        root.innerHTML = '<h1>Game Review</h1><div class="subtitle">'+n.w+' ('+n.wElo+') vs '+n.b+' ('+n.bElo+') — '+n.result+'</div>'
          + (analysis.book ? '<div class="subtitle" style="margin-top:2px">'+analysis.book.name+' ('+analysis.book.code+')</div>' : '')
          + '<div style="margin-top:20px">'
          + '<div class="card"><div class="card-title">Accuracy</div><table><tr><th></th><th>'+n.w+'</th><th>'+n.b+'</th></tr>'
          + '<tr><td>Accuracy</td><td class="accuracy-big">'+fmt(C.white.all)+'</td><td class="accuracy-big">'+fmt(C.black.all)+'</td></tr>'
          + '<tr><td>Rating</td><td>'+n.wElo+'</td><td>'+n.bElo+'</td></tr></table></div>'
          + '<div class="card"><div class="card-title">Move Classifications</div><table><tr><th></th><th>'+n.w+'</th><th>'+n.b+'</th></tr>'+clsRows+'</table></div>'
          + '<div class="card"><div class="card-title">Accuracy by Phase</div><table><tr><th></th><th>'+n.w+'</th><th>'+n.b+'</th></tr>'
          + '<tr><td>Opening</td><td>'+fmt(C.white.gp0)+'</td><td>'+fmt(C.black.gp0)+'</td></tr>'
          + '<tr><td>Middlegame</td><td>'+fmt(C.white.gp1)+'</td><td>'+fmt(C.black.gp1)+'</td></tr>'
          + '<tr><td>Endgame</td><td>'+fmt(C.white.gp2)+'</td><td>'+fmt(C.black.gp2)+'</td></tr></table></div>'
          + '<div class="card"><div class="card-title">Accuracy by Piece</div><table><tr><th></th><th>'+n.w+'</th><th>'+n.b+'</th></tr>'+pieceRows+'</table></div>'
          + (analysis.gameSummary ? '<div class="card"><div class="card-title">Game Summary</div><div class="summary">"'+analysis.gameSummary+'"</div></div>' : '')
          + '<button class="btn" onclick="view=\\'review\\';currentPly=0;render()">Start Review</button>'
          + '</div>';
      }

      function renderReview() {
        const n = getNames();
        const pos = analysis.positions || [];
        const p = pos[currentPly] || {};
        const cls = p.classificationName || '';
        const played = p.playedMove;
        const best = p.bestMove;
        const speech = played?.speech?.[0]?.sentence?.join('') || best?.speech?.[0]?.sentence?.join('') || '';
        const evalStr = played?.score != null ? (played.score >= 0 ? '+' : '') + played.score.toFixed(2) : '';
        const clsLabel = {brilliant:'Brilliant',great:'Great',best:'Best',excellent:'Excellent',good:'Good',book:'Book',inaccuracy:'Inaccuracy',mistake:'Mistake',miss:'Miss',blunder:'Blunder'}[cls] || cls;
        const clsColor = {brilliant:'cls-brilliant',great:'cls-great',best:'cls-best',excellent:'cls-excellent',good:'cls-good',book:'cls-book',inaccuracy:'cls-inaccuracy',mistake:'cls-mistake',miss:'cls-miss',blunder:'cls-blunder'}[cls] || '';
        const bgColor = {brilliant:'rgba(34,211,238,0.1)',great:'rgba(34,211,238,0.07)',best:'rgba(52,211,153,0.1)',excellent:'rgba(110,231,183,0.07)',good:'rgba(226,232,240,0.05)',book:'rgba(167,139,250,0.07)',inaccuracy:'rgba(251,191,36,0.07)',mistake:'rgba(251,146,60,0.07)',miss:'rgba(239,68,68,0.07)',blunder:'rgba(248,113,113,0.1)'}[cls] || '#1e1e3a';

        // Move list
        let moveListHtml = '';
        for (let i = 1; i < pos.length; i++) {
          const pp = pos[i];
          if (!pp.color) continue;
          const num = Math.ceil(i/2);
          const san = pp.playedMove?.moveLan || '?';
          const c = pp.classificationName || '';
          const icon = {brilliant:'!!',great:'!',best:'★',excellent:'●',good:'●',book:'📖',inaccuracy:'?!',mistake:'?',miss:'✕',blunder:'??'}[c] || '';
          const cc = {brilliant:'cls-brilliant',great:'cls-great',best:'cls-best',excellent:'cls-excellent',good:'cls-good',book:'cls-book',inaccuracy:'cls-inaccuracy',mistake:'cls-mistake',miss:'cls-miss',blunder:'cls-blunder'}[c] || '';
          if (pp.color === 'white') {
            moveListHtml += '<div class="move-row"><div class="move-num">'+num+'.</div>';
            moveListHtml += '<div class="move-cell'+(currentPly===i?' active':'')+'" onclick="currentPly='+i+';render()"><span class="move-cls '+cc+'">'+icon+'</span><span class="move-san">'+san+'</span></div>';
          } else {
            if (!moveListHtml.endsWith('</div></div>') || moveListHtml.endsWith('</div></div></div>')) {
              moveListHtml += '<div class="move-row"><div class="move-num">'+num+'.</div><div></div>';
            }
            moveListHtml += '<div class="move-cell'+(currentPly===i?' active':'')+'" onclick="currentPly='+i+';render()"><span class="move-cls '+cc+'">'+icon+'</span><span class="move-san">'+san+'</span></div></div>';
          }
        }

        // Coach card
        let coachHtml = '';
        if (currentPly > 0) {
          coachHtml = '<div class="coach-card"><div class="coach-header" style="background:'+bgColor+'"><span class="'+clsColor+'" style="font-weight:700;font-size:16px">'+(played?.moveLan||'?')+' is '+clsLabel.toLowerCase()+'</span>'+(evalStr?'<span class="coach-eval">'+evalStr+'</span>':'')+'</div><div class="coach-body">'
            + (speech ? '<div>'+speech+'</div>' : '<div style="color:#9ca3af;font-style:italic">No coach comment.</div>');
          if (best && !['best','book','brilliant','great','excellent'].includes(cls)) {
            coachHtml += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #2a2a4a"><div style="color:#9ca3af;font-size:11px;margin-bottom:4px">Better move:</div><div style="color:#34d399;font-weight:700;font-family:monospace">'+best.moveLan+(best.speech?.[0]?.sentence?' <span style="color:#9ca3af;font-weight:400;font-family:sans-serif">— '+best.speech[0].sentence.join('')+'</span>':'')+'</div></div>';
          }
          const followUp = best?.variationThemes?.[0]?.moves;
          if (followUp?.length) {
            coachHtml += '<div style="margin-top:8px"><div class="follow-up">' + followUp.map(m => '<span>'+m+'</span>').join('') + '</div></div>';
          }
          coachHtml += '</div></div>';
        } else {
          coachHtml = '<div class="card"><div style="color:#9ca3af">Starting position — use arrows to navigate moves</div></div>';
        }

        root.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><div><h1>Game Review</h1><div class="subtitle">'+n.w+' vs '+n.b+'</div></div><button class="nav-btn" style="width:auto;padding:0 12px" onclick="view=\\'summary\\';render()">← Summary</button></div>'
          + '<div class="board-container"><div class="board-right">'
          + coachHtml
          + '<div class="card" style="padding:8px"><div style="color:#9ca3af;font-size:11px;text-transform:uppercase;padding:8px 8px 4px">Moves</div><div class="move-list">'+moveListHtml+'</div></div>'
          + '<div class="nav-buttons"><button class="nav-btn" onclick="currentPly=0;render()">|&lt;</button><button class="nav-btn" onclick="if(currentPly>0)currentPly--;render()">&lt;</button><button class="nav-btn" onclick="if(currentPly<'+(pos.length-1)+')currentPly++;render()">&gt;</button><button class="nav-btn" onclick="currentPly='+(pos.length-1)+';render()">&gt;|</button></div>'
          + '</div></div>';
      }

      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (view !== 'review') return;
        const pos = analysis?.positions || [];
        if (e.key === 'ArrowRight' && currentPly < pos.length - 1) { currentPly++; render(); }
        if (e.key === 'ArrowLeft' && currentPly > 0) { currentPly--; render(); }
        if (e.key === 'Home') { currentPly = 0; render(); }
        if (e.key === 'End') { currentPly = pos.length - 1; render(); }
      });
    }
  </script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(reviewHtml);
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
  let clientSource: string | null = null; // 'app' or 'extension'

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

        clientSource = message.source || null; // 'app' or 'extension'
        logConnection(user.email || userId, 'connected', clientSource || undefined);

        // Get maintenance schedule and Discord status for the client
        const maintenance = await getMaintenanceSchedule();

        const { data: userSettings } = await supabase
          .from("user_settings")
          .select("discord_id, discord_username, discord_avatar, freetrial_used, discord_in_guild, beta_flags")
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
            betaFlags: resolveUserBetas(userSettings?.beta_flags ?? []),
          }),
        );
        return;
      }

      // All other messages require authentication
      if (!isAuthenticated || !userId) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      // Handle fingerprint (sent separately after auth to avoid timeout)
      if (message.type === "fingerprint" && message.fingerprint) {
        storeFingerprint(userId, message.fingerprint);
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

        case "chesscom_review":
          if (!clientSource) clientSource = 'app';
          logStart({ requestId: message.gameId || userId!, email: client.user.email, type: 'game-review', params: `gameId=${message.gameId}` });
          handleChesscomReview(message, ws, userId, supabase, client.user.email);
          break;

        case "profile_analysis_start": {
          if (!clientSource) clientSource = 'app';
          const modesStr = message.modes ? `modes=${message.modes.join(',')} x${message.gamesPerMode}` : `last ${message.gamesCount || 10}`;
          logStart({ requestId: message.analysisId || userId!, email: client.user.email, type: 'profile-analysis', params: `${message.platformUsername} (${modesStr})` });
          handleProfileAnalysis(message as ProfileAnalysisStartMessage, ws, userId);
          break;
        }

        case "profile_analysis_subscribe":
          if (!clientSource) clientSource = 'app';
          logStart({ requestId: message.analysisId || userId!, email: client.user.email, type: 'profile-analysis', params: `subscribe ${message.analysisId?.slice(0, 8)}` });
          handleProfileAnalysisSubscribe(message as ProfileAnalysisSubscribeMessage, ws, userId);
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
      handleProfileAnalysisDisconnect(ws);
      clients.delete(userId);
      clientAlive.delete(userId);
      if (clientSource !== 'app') {
        logConnection(client?.user.email || userId, 'disconnected', clientSource || undefined);
      }
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
