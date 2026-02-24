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
import { logConnection } from "./utils/logger.js";

const PORT = parseInt(process.env.PORT || "8080");
const MAX_KOMODO_INSTANCES = parseInt(process.env.MAX_KOMODO_INSTANCES || "2");
const MAX_STOCKFISH_INSTANCES = parseInt(
  process.env.MAX_STOCKFISH_INSTANCES || "1",
);

// Version info for extension update checks
const VERSION_INFO = {
  minVersion: "0.0.3",
  downloadUrl: "https://download.chessr.io",
};

// Initialize Supabase client with service role key for token verification
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

// Store authenticated connections
const clients = new Map<string, Client>();

// =============================================================================
// HTTP Server for version endpoint
// =============================================================================
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Version endpoint
  if (req.url === "/version" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(VERSION_INFO));
    return;
  }

  // Stats endpoint for admin dashboard
  if (req.url === "/stats" && req.method === "GET") {
    const suggestionStats = getStats();
    const analysisStats = getAnalysisStats();
    const openingStats = getOpeningStats();

    const stats = {
      realtime: {
        connectedUsers: clients.size,
        connectedClients: wss.clients.size,
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

wss.on("connection", (ws: WebSocket) => {

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

        logConnection(user.email || userId, 'connected');
        ws.send(
          JSON.stringify({
            type: "auth_success",
            user: {
              id: user.id,
              email: user.email,
            },
          }),
        );
        return;
      }

      // All other messages require authentication
      if (!isAuthenticated || !userId) {
        ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
        return;
      }

      // Handle message types
      switch (message.type) {
        case "suggestion":
          handleSuggestionRequest(
            message as SuggestionMessage,
            clients.get(userId)!,
          );
          break;

        case "analyze":
          handleAnalysisRequest(
            message as AnalysisMessage,
            clients.get(userId)!,
          );
          break;

        case "get_linked_accounts":
          handleGetLinkedAccounts(clients.get(userId)!);
          break;

        case "link_account":
          handleLinkAccount(
            message as LinkAccountMessage,
            clients.get(userId)!,
          );
          break;

        case "unlink_account":
          handleUnlinkAccount(
            message as UnlinkAccountMessage,
            clients.get(userId)!,
          );
          break;

        case "check_cooldown":
          handleCheckCooldown(
            message as CheckCooldownMessage,
            clients.get(userId)!,
          );
          break;

        case "get_opening":
          handleOpeningRequest(
            message as OpeningMessage,
            clients.get(userId)!,
          );
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

  ws.on("close", () => {
    clearTimeout(authTimeout);
    if (userId) {
      const client = clients.get(userId);
      // Cancel any pending requests for this user
      handleUserDisconnect(userId);
      handleAnalysisDisconnect(userId);
      clients.delete(userId);
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
