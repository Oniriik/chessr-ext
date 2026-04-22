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
import { licenseRoutes } from './routes/license.js';
import { installConsoleCapture } from './lib/logBuffer.js';
import { startSysMetrics } from './lib/sysMetrics.js';

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
app.route('/', licenseRoutes);
registerWsRoute({ app, upgradeWebSocket });

// Start
const port = Number(process.env.PORT) || 8080;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Chessr v3 server running on http://localhost:${port}`);
});

injectWebSocket(server);
