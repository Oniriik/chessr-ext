// Load environment variables FIRST before any other modules
import './env.js';

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { EnginePool } from './engine-pool.js';
import { ClientMessage, ServerMessage, UserInfo } from './types.js';
import { validateSupabaseToken } from './auth.js';
import { MetricsCollector } from './metrics.js';
import { Logger, globalLogger } from './logger.js';
import { versionConfig, isVersionOutdated } from './version-config.js';
import { telemetry } from './telemetry.js';
import { handleAnalyze, handleAnalyzeStats, handleAnalyzeSuggestions } from './analyze-pipeline.js';
import { startApiServer } from './api-server.js';

const PORT = 3000;
const METRICS_PORT = 3001;

// Pool configuration from environment or defaults (optimized for 2 vCPU / 2GB RAM)
const POOL_CONFIG = {
  minEngines: parseInt(process.env.POOL_MIN_ENGINES || '1', 10),
  maxEngines: parseInt(process.env.POOL_MAX_ENGINES || '2', 10),
  scaleUpThreshold: parseInt(process.env.POOL_SCALE_UP_THRESHOLD || '1', 10),
  scaleDownIdleTime: parseInt(process.env.POOL_SCALE_DOWN_IDLE_TIME || '60000', 10),
  engineOptions: {
    threads: parseInt(process.env.ENGINE_THREADS || '1', 10),
    hash: parseInt(process.env.ENGINE_HASH || '32', 10),
  },
};

class ChessServer {
  private wss: WebSocketServer;
  private pool: EnginePool;
  private clients = new Map<WebSocket, UserInfo>();
  private metricsServer: ReturnType<typeof createServer>;
  private metrics: MetricsCollector;

  constructor(port: number) {
    this.pool = new EnginePool(POOL_CONFIG);
    this.wss = new WebSocketServer({ port });
    this.metrics = new MetricsCollector(this.clients, this.pool);
    this.metricsServer = this.createMetricsServer();

    this.init(port);
  }

  private async init(port: number) {
    try {
      await this.pool.init();
      telemetry.init();
      globalLogger.info('server_started', {
        wsPort: port,
        metricsPort: METRICS_PORT,
        poolMin: POOL_CONFIG.minEngines,
        poolMax: POOL_CONFIG.maxEngines,
      });

      this.wss.on('connection', (ws) => this.handleConnection(ws));
      this.metricsServer.listen(METRICS_PORT);
    } catch (err) {
      globalLogger.error('server_init_failed', err instanceof Error ? err : String(err));
      process.exit(1);
    }
  }

  private createMetricsServer() {
    const server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.url === '/metrics' && req.method === 'GET') {
        const metrics = this.metrics.getMetrics();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metrics, null, 2));
      } else if (req.url === '/version' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          minVersion: versionConfig.minVersion,
          downloadUrl: versionConfig.downloadUrl,
        }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    return server;
  }

  private handleConnection(ws: WebSocket) {
    const connectionId = Logger.createRequestId();

    this.clients.set(ws, {
      id: connectionId,
      email: 'anonymous',
      connectedAt: new Date().toISOString(),
      authenticated: false,
    });

    globalLogger.info('client_connected', { connectionId });
    telemetry.recordConnection();
    this.send(ws, {
      type: 'ready',
      version: {
        minVersion: versionConfig.minVersion,
        downloadUrl: versionConfig.downloadUrl,
      },
    });

    ws.on('message', (data) => this.handleMessage(ws, data.toString()));

    ws.on('close', () => {
      const userInfo = this.clients.get(ws);
      globalLogger.info('client_disconnected', {
        connectionId: userInfo?.id,
        user: userInfo?.email,
      });
      telemetry.recordDisconnection();

      // Check if this authenticated user has other connections before removing
      if (userInfo?.authenticated && userInfo.email !== 'anonymous') {
        this.clients.delete(ws);
        const hasMoreConnections = Array.from(this.clients.values()).some(
          u => u.authenticated && u.email === userInfo.email
        );
        telemetry.recordAuthenticatedDisconnect(userInfo.email, hasMoreConnections);
      } else {
        this.clients.delete(ws);
      }
    });

    ws.on('error', (err) => {
      const userInfo = this.clients.get(ws);
      globalLogger.error('websocket_error', err, {
        connectionId: userInfo?.id,
        user: userInfo?.email,
      });
    });
  }

  private getClientInfo(ws: WebSocket): UserInfo {
    return this.clients.get(ws) || {
      id: 'unknown',
      email: 'anonymous',
      connectedAt: new Date().toISOString(),
      authenticated: false,
    };
  }

  private async handleMessage(ws: WebSocket, rawData: string) {
    const clientInfo = this.getClientInfo(ws);

    let message: ClientMessage;
    try {
      message = JSON.parse(rawData);
    } catch {
      // Create temporary logger for parse error
      const tempLogger = new Logger(Logger.createRequestId());
      tempLogger.error('parse_error', clientInfo.email, 'Invalid JSON');
      this.send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    // Use requestId from message if available, otherwise generate one
    const requestId = (message as any).requestId || Logger.createRequestId();
    const logger = new Logger(requestId);

    switch (message.type) {
      case 'analyze':
        await this.handleAnalyze(ws, message, logger);
        break;

      case 'analyze_stats':
        await this.handleAnalyzeStats(ws, message as any, logger);
        break;

      case 'analyze_suggestions':
        await this.handleAnalyzeSuggestions(ws, message as any, logger);
        break;

      case 'auth':
        this.handleAuth(ws, message, logger);
        break;

      default:
        logger.info('unknown_message', clientInfo.email, { type: (message as any).type });
        this.send(ws, { type: 'error', message: 'Unknown message type' });
    }
  }

  private async handleAnalyze(
    ws: WebSocket,
    message: ClientMessage & { type: 'analyze' },
    logger: Logger
  ): Promise<void> {
    const clientInfo = this.getClientInfo(ws);

    logger.info('analysis_request', clientInfo.email, {
      requestId: message.requestId || 'none',
      movesCount: message.payload.movesUci.length,
      targetElo: message.payload.user.targetElo,
      multiPV: message.payload.user.multiPV,
      lastMoves: message.payload.review.lastMoves,
    });

    try {
      // Get engine from pool for direct UCI control
      const engine = await this.pool.getEngineForDirectUse();

      try {
        // Run the analysis pipeline
        const result = await handleAnalyze(engine, message, clientInfo.email);

        // Check if result is success or error
        if (result.type === 'analyze_error') {
          logger.error('analysis_error', clientInfo.email, result.error.message);
          this.send(ws, result);
          return;
        }

        // Format timing: ms if < 1s, otherwise seconds
        const formatTime = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;

        logger.info('analysis_complete', clientInfo.email, {
          requestId: result.requestId,
          reviewMs: formatTime(result.meta.timings.reviewMs),
          suggestionMs: formatTime(result.meta.timings.suggestionMs),
          totalMs: formatTime(result.meta.timings.totalMs),
          suggestions: result.payload.suggestions.suggestions.length,
        });

        this.metrics.incrementSuggestions(result.payload.suggestions.suggestions.length);
        this.send(ws, result);
      } finally {
        // Always return engine to pool
        this.pool.releaseEngine(engine);
      }
    } catch (err) {
      logger.error('analysis_error', clientInfo.email, err instanceof Error ? err : String(err));

      // Send properly formatted error response
      this.send(ws, {
        type: 'analyze_error',
        requestId: message.requestId || '',
        error: {
          code: 'ANALYZE_FAILED',
          message: err instanceof Error ? err.message : 'Analysis failed',
        },
        meta: { engine: 'KomodoDragon' },
      });
    }
  }

  private async handleAnalyzeStats(
    ws: WebSocket,
    message: any,
    logger: Logger
  ): Promise<void> {
    const clientInfo = this.getClientInfo(ws);

    logger.info('stats_request', clientInfo.email, {
      requestId: message.requestId || 'none',
      movesCount: message.payload?.movesUci?.length || 0,
      lastMoves: message.payload?.review?.lastMoves || 1,
      cachedCount: message.payload?.review?.cachedAccuracy?.length || 0,
    });

    try {
      // Get engine from pool for direct UCI control
      const engine = await this.pool.getEngineForDirectUse();

      try {
        // Run stats-only (accuracy review)
        const result = await handleAnalyzeStats(engine, message, clientInfo.email);

        // Check if result is success or error
        if (result.type === 'analyze_error') {
          logger.info('stats_error', clientInfo.email, { errorMessage: result.error.message });
          this.send(ws, result);
          return;
        }

        telemetry.recordStats();
        this.send(ws, result);
      } finally {
        // Always return engine to pool
        this.pool.releaseEngine(engine);
      }
    } catch (err) {
      logger.info('stats_error', clientInfo.email, { errorMessage: err instanceof Error ? err.message : String(err) });

      // Send properly formatted error response
      this.send(ws, {
        type: 'analyze_error',
        requestId: message.requestId || '',
        error: {
          code: 'STATS_FAILED',
          message: err instanceof Error ? err.message : 'Stats analysis failed',
        },
        meta: { engine: 'KomodoDragon' },
      });
    }
  }

  private async handleAnalyzeSuggestions(
    ws: WebSocket,
    message: any,
    logger: Logger
  ): Promise<void> {
    const clientInfo = this.getClientInfo(ws);

    logger.info('suggestions_request', clientInfo.email, {
      requestId: message.requestId || 'none',
      movesCount: message.payload?.movesUci?.length || 0,
      targetElo: message.payload?.user?.targetElo,
      multiPV: message.payload?.user?.multiPV,
      hasCachedStats: !!message.payload?.cachedStats?.accuracy,
    });

    try {
      // Get engine from pool for direct UCI control
      const engine = await this.pool.getEngineForDirectUse();

      try {
        // Run suggestions-only (engine reset + suggestions)
        const result = await handleAnalyzeSuggestions(engine, message, clientInfo.email);

        // Check if result is success or error
        if (result.type === 'analyze_error') {
          logger.info('suggestions_error', clientInfo.email, { errorMessage: result.error.message });
          this.send(ws, result);
          return;
        }

        this.metrics.incrementSuggestions(result.payload.suggestions.suggestions.length);
        telemetry.recordSuggestion();
        this.send(ws, result);
      } finally {
        // Always return engine to pool
        this.pool.releaseEngine(engine);
      }
    } catch (err) {
      logger.info('suggestions_error', clientInfo.email, { errorMessage: err instanceof Error ? err.message : String(err) });

      // Send properly formatted error response
      this.send(ws, {
        type: 'analyze_error',
        requestId: message.requestId || '',
        error: {
          code: 'SUGGESTIONS_FAILED',
          message: err instanceof Error ? err.message : 'Suggestions analysis failed',
        },
        meta: { engine: 'KomodoDragon' },
      });
    }
  }

  private handleAuth(
    ws: WebSocket,
    message: ClientMessage & { type: 'auth' },
    logger: Logger
  ) {
    const clientInfo = this.getClientInfo(ws);

    // Check version if provided
    if (message.version && isVersionOutdated(message.version)) {
      logger.info('version_outdated', clientInfo.email, { clientVersion: message.version, minVersion: versionConfig.minVersion });
      this.send(ws, {
        type: 'version_error',
        minVersion: versionConfig.minVersion,
        downloadUrl: versionConfig.downloadUrl,
      });
      ws.close(4002, 'Version outdated');
      return;
    }

    const userInfo = validateSupabaseToken(message.token);

    if (userInfo) {
      this.clients.set(ws, {
        id: clientInfo.id,
        email: userInfo.email,
        connectedAt: clientInfo.connectedAt,
        authenticated: true,
      });

      logger.info('auth_success', userInfo.email, { userId: userInfo.id });
      telemetry.recordAuthentication(userInfo.email);

      this.send(ws, {
        type: 'auth_success',
        user: {
          id: userInfo.id,
          email: userInfo.email,
        },
      });
    } else {
      logger.error('auth_failed', clientInfo.email, 'Invalid token');
      this.send(ws, {
        type: 'error',
        message: 'Authentication failed',
      });
      ws.close(4001, 'Authentication failed');
    }
  }

  private send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

// Start WebSocket server
new ChessServer(PORT);

// Start REST API server for subscriptions
startApiServer();
