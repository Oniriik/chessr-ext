import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { loggerMiddleware } from './middleware/logger.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWsRoute } from './routes/ws.js';
import { discordRoutes } from './routes/discord.js';
import { accountRoutes } from './routes/accounts.js';
import { explanationRoutes } from './routes/explanation.js';
import { adminLogsRoutes } from './routes/adminLogs.js';
import { installConsoleCapture } from './lib/logBuffer.js';
import { startSysMetrics } from './lib/sysMetrics.js';
import { initEnginePool, shutdownEnginePool } from './handlers/suggestionHandler.js';
import { initStockfishPool, shutdownStockfishPool } from './handlers/analysisHandler.js';

// Capture stdout before any other log fires so the dashboard sees boot events
installConsoleCapture();
startSysMetrics();

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Middleware
app.use('*', cors());
app.use('*', loggerMiddleware);

// Routes
registerHealthRoutes(app);
app.route('/', discordRoutes);
app.route('/', accountRoutes);
app.route('/', explanationRoutes);
app.route('/', adminLogsRoutes);
registerWsRoute({ app, upgradeWebSocket });

// Start
const port = Number(process.env.PORT) || 8080;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Chessr v3 server running on http://localhost:${port}`);
});

injectWebSocket(server);

// Engine pools — Komodo for suggestion fallback, Stockfish for analysis
// fallback. Failures are non-fatal: the server can still serve telemetry /
// chesscom_review / health without engines. Extension will just get
// suggestion_error / analysis_error back.
const MAX_KOMODO = Number(process.env.MAX_KOMODO_INSTANCES) || 2;
const MAX_STOCKFISH = Number(process.env.MAX_STOCKFISH_INSTANCES) || 1;

initEnginePool(MAX_KOMODO)
  .then(() => console.log(`[Engines] Komodo pool ready (${MAX_KOMODO} instances)`))
  .catch((err) => console.error('[Engines] Komodo pool failed to init — server-side suggestion fallback unavailable:', err));

initStockfishPool(MAX_STOCKFISH)
  .then(() => console.log(`[Engines] Stockfish pool ready (${MAX_STOCKFISH} instances)`))
  .catch((err) => console.error('[Engines] Stockfish pool failed to init — server-side analysis fallback unavailable:', err));

// Graceful shutdown
async function shutdown() {
  console.log('[Engines] Shutting down pools...');
  await Promise.allSettled([shutdownEnginePool(), shutdownStockfishPool()]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
