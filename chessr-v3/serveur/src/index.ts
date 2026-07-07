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
import { adminEventsRoutes } from './routes/adminEvents.js';
import { freetrialRoutes } from './routes/freetrial.js';
import { guidelinesRoutes } from './routes/guidelines.js';
import { adminMessagingRoutes } from './routes/adminMessaging.js';
import { abuseRoutes } from './routes/abuse.js';
import { adminAbuseRoutes } from './routes/adminAbuse.js';
import { engineLoadRoutes } from './routes/engineLoad.js';
import { adminWheelRoutes } from './routes/adminWheel.js';
import { adminGiveawayRoutes } from './routes/adminGiveaway.js';
import { adminInviteRoutes } from './routes/adminInvites.js';
import { adminTicketRoutes } from './routes/adminTickets.js';
import { adminAnalyticsRoutes } from './routes/adminAnalytics.js';
import { adminUsersRoutes } from './routes/adminUsers.js';
import { adminDiscordRoutes } from './routes/adminDiscord.js';
import { limitsRoutes } from './routes/limits.js';
import { statsRoutes } from './routes/stats.js';
import {
  handlePaddleWebhook,
  handlePaddleBillingLink,
  handlePaddleCheckout,
  handlePaddleCheckoutByToken,
  handlePaddleSubscriptionStatus,
  handleStatusByToken,
  handlePaddleSwitch,
  handleSwitchByToken,
  handlePaddleCancel,
  handleCancelByToken,
  handlePaddlePreviewUpgrade,
  handlePreviewUpgradeByToken,
  handlePaddleUpgradeLifetime,
  handleUpgradeLifetimeByToken,
  handlePaddlePrices,
  handleExtendPaddleSubscription,
} from './handlers/paddleHandler.js';
import {
  handleCryptoCheckoutByToken,
  handleCryptoIpn,
} from './handlers/cryptoHandler.js';
import { installConsoleCapture } from './lib/logBuffer.js';
import { startSysMetrics } from './lib/sysMetrics.js';
import { initSuggestionWorker, shutdownSuggestionWorker } from './queue/suggestionQueue.js';
import { initAnalysisWorker, shutdownAnalysisWorker } from './queue/analysisQueue.js';
import { initMaiaWorker, shutdownMaiaWorker } from './queue/maiaQueue.js';
import { initMaia3Worker, shutdownMaia3Worker } from './queue/maia3Queue.js';
import { startQueueStats, stopQueueStats } from './queue/stats.js';
import { registerCron, startCrons, stopCrons } from './lib/cron.js';
import { runGiveawayDraw } from './jobs/giveawayDraw.js';
import { runTicketAutoDelete } from './jobs/ticketAutoDelete.js';
import { runEloRefresh } from './jobs/eloRefresh.js';
import { runPlanExpiry } from './jobs/planExpiry.js';

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
app.route('/', adminEventsRoutes);
app.route('/', freetrialRoutes);
app.route('/', guidelinesRoutes);
app.route('/', adminMessagingRoutes);
app.route('/', abuseRoutes);
app.route('/', adminAbuseRoutes);
app.route('/', engineLoadRoutes);
app.route('/', adminWheelRoutes);
app.route('/', adminGiveawayRoutes);
app.route('/', adminInviteRoutes);
app.route('/', adminTicketRoutes);
app.route('/', adminAnalyticsRoutes);
app.route('/', adminUsersRoutes);
app.route('/', adminDiscordRoutes);
app.route('/', limitsRoutes);
app.route('/', statsRoutes);

// Paddle billing — webhook (signed, Paddle → us) + the full set of
// extension-authenticated and billing-token endpoints. Same routes,
// params and response shapes as chessr-next so the DNS flip is a no-op.
app.post('/api/paddle/webhook', handlePaddleWebhook);
app.post('/api/paddle/billing-link', handlePaddleBillingLink);
app.post('/api/paddle/checkout', handlePaddleCheckout);
app.post('/api/paddle/checkout-by-token', handlePaddleCheckoutByToken);
app.get ('/api/paddle/subscription', handlePaddleSubscriptionStatus);
app.post('/api/paddle/status-by-token', handleStatusByToken);
app.post('/api/paddle/switch', handlePaddleSwitch);
app.post('/api/paddle/switch-by-token', handleSwitchByToken);
app.post('/api/paddle/cancel', handlePaddleCancel);
app.post('/api/paddle/cancel-by-token', handleCancelByToken);
app.post('/api/paddle/preview-upgrade', handlePaddlePreviewUpgrade);
app.post('/api/paddle/preview-upgrade-by-token', handlePreviewUpgradeByToken);
app.post('/api/paddle/upgrade-lifetime', handlePaddleUpgradeLifetime);
app.post('/api/paddle/upgrade-lifetime-by-token', handleUpgradeLifetimeByToken);
app.get ('/api/paddle/prices', handlePaddlePrices);
app.post('/admin/paddle/extend', handleExtendPaddleSubscription);

// NOWPayments crypto rail — one-time payments only (flex/yearly/lifetime).
// checkout-by-token mirrors paddle's token flow; ipn is NOWPayments → us,
// signed with x-nowpayments-sig.
app.post('/api/crypto/checkout-by-token', handleCryptoCheckoutByToken);
app.post('/api/crypto/ipn', handleCryptoIpn);

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

// In-process crons. Add new jobs here via registerCron(). Each one runs
// on its own setInterval; overlapping ticks are skipped.
registerCron({
  name: 'giveaway-draw',
  intervalMs: 60_000,
  runImmediately: true,
  run: runGiveawayDraw,
});
registerCron({
  name: 'ticket-auto-delete',
  intervalMs: 5 * 60_000,
  runImmediately: true,
  run: runTicketAutoDelete,
});
registerCron({
  name: 'elo-refresh',
  intervalMs: 60_000,        // 1 min — matches the v2 cron cadence
  runImmediately: true,
  run: runEloRefresh,
});
registerCron({
  name: 'plan-expiry',
  intervalMs: 5 * 60_000,    // 5 min — batch of 10 keeps Discord rate limits safe
  runImmediately: true,
  run: runPlanExpiry,
});
startCrons();

// Graceful shutdown
async function shutdown() {
  console.log('[Engines] Shutting down BullMQ workers...');
  stopQueueStats();
  stopCrons();
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
