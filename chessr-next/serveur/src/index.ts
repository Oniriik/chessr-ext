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
  handleUnlinkDiscord,
  type InitDiscordLinkMessage,
} from "./handlers/discordHandler.js";
import { logConnection } from "./utils/logger.js";

const PORT = parseInt(process.env.PORT || "8080");
const MAX_KOMODO_INSTANCES = parseInt(process.env.MAX_KOMODO_INSTANCES || "2");
const MAX_STOCKFISH_INSTANCES = parseInt(
  process.env.MAX_STOCKFISH_INSTANCES || "1",
);

// Version info for extension update checks
const VERSION_INFO = {
  minVersion: "2.0.2",
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

// Discord webhook for signup notifications
const DISCORD_SIGNUP_WEBHOOK_URL = process.env.DISCORD_SIGNUP_WEBHOOK_URL;

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

// Send Discord webhook for blocked signup attempts
async function reportBlockedSignup(
  email: string,
  ip: string | null,
): Promise<void> {
  if (!DISCORD_SIGNUP_WEBHOOK_URL) return;

  const cleanIp = cleanIpAddress(ip);
  let countryText = "Unknown";

  if (cleanIp) {
    const { country } = await resolveIpCountry(cleanIp);
    if (country) countryText = country;
  }

  try {
    await fetch(DISCORD_SIGNUP_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    console.error("[Discord] Failed to send blocked signup webhook:", e);
  }
}

// =============================================================================
// HTTP Server for version endpoint
// =============================================================================
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

  // Stats endpoint for admin dashboard
  if (req.url === "/stats" && req.method === "GET") {
    const suggestionStats = getStats();
    const analysisStats = getAnalysisStats();
    const openingStats = getOpeningStats();

    // Get list of connected users
    const connectedUsersList = Array.from(clients.values()).map((client) => ({
      id: client.user.id,
      email: client.user.email,
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
