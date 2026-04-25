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
import { initSuggestionWorker, shutdownSuggestionWorker } from './queue/suggestionQueue.js';
import { initAnalysisWorker, shutdownAnalysisWorker } from './queue/analysisQueue.js';
import { initMaiaWorker, shutdownMaiaWorker } from './queue/maiaQueue.js';
import { initMaia3Worker, shutdownMaia3Worker } from './queue/maia3Queue.js';
import { startQueueStats, stopQueueStats } from './queue/stats.js';

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

// BullMQ workers — Komodo for suggestion fallback, Stockfish for analysis
// + single-FEN eval. Each worker wraps an in-process engine pool. Failures
// are non-fatal: the server still serves telemetry + /chesscom_review.
// Clients will get suggestion_error / analysis_error if the worker is
// unavailable (no queue to enqueue into).
const MAX_KOMODO = Number(process.env.MAX_KOMODO_INSTANCES) || 2;
const MAX_STOCKFISH = Number(process.env.MAX_STOCKFISH_INSTANCES) || 1;
const MAX_MAIA = Number(process.env.MAX_MAIA_INSTANCES) || 1;
const MAX_MAIA3 = Number(process.env.MAX_MAIA3_INSTANCES) || 2;

initSuggestionWorker(MAX_KOMODO)
  .catch((err) => console.error('[Engines] Suggestion worker failed to init:', err));

initAnalysisWorker(MAX_STOCKFISH)
  .catch((err) => console.error('[Engines] Analysis worker failed to init:', err));

initMaiaWorker(MAX_MAIA)
  .catch((err) => console.error('[Engines] Maia worker failed to init:', err));

initMaia3Worker(MAX_MAIA3)
  .catch((err) => console.error('[Engines] Maia3 worker failed to init:', err));

startQueueStats();

// Graceful shutdown
async function shutdown() {
  console.log('[Engines] Shutting down BullMQ workers...');
  stopQueueStats();
  await Promise.allSettled([
    shutdownSuggestionWorker(),
    shutdownAnalysisWorker(),
    shutdownMaiaWorker(),
    shutdownMaia3Worker(),
  ]);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
