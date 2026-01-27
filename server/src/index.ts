import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { EnginePool } from './engine-pool.js';
import { ClientMessage, ServerMessage, UserInfo } from './types.js';
import { validateSupabaseToken } from './auth.js';
import { MetricsCollector } from './metrics.js';
import { Logger, globalLogger } from './logger.js';
import { versionConfig, isVersionOutdated } from './version-config.js';
import { telemetry } from './telemetry.js';

const PORT = 3000;
const METRICS_PORT = 3001;

// Pool configuration - optimized for 2 vCPU / 2GB RAM server
const POOL_CONFIG = {
  minEngines: 1,      // Keep 1 engine ready at minimum
  maxEngines: 2,      // Max 2 engines for 2 vCPU
  scaleUpThreshold: 1, // Scale up when 1+ requests queued
  scaleDownIdleTime: 60000, // Scale down after 1 min of inactivity
  engineOptions: { threads: 1, hash: 32 }, // 1 thread per engine, 32MB hash
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
    const requestId = Logger.createRequestId();
    const logger = new Logger(requestId);

    let message: ClientMessage;
    try {
      message = JSON.parse(rawData);
    } catch {
      logger.error('parse_error', clientInfo.email, 'Invalid JSON');
      this.send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (message.type) {
      case 'analyze':
        await this.handleAnalyze(ws, message, logger);
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
      depth: message.depth,
      elo: message.elo,
      personality: message.personality,
      multiPV: message.multiPV,
      movesCount: message.moves?.length || 0,
      moves: message.moves?.length > 0 ? message.moves.join(' ') : '(empty)',
    });

    try {
      const result = await this.pool.analyze(
        message.fen,
        {
          moves: message.moves,
          searchMode: message.searchMode || 'depth',
          depth: message.depth,
          moveTime: message.moveTime || 1000,
          multiPV: message.multiPV,
          elo: message.elo,
          personality: message.personality || 'Default',
        },
        () => {}
      );

      // Format moves summary: "1. e2e4 (+0.3) 2. d2d4 (+0.2) 3. g1f3 (+0.1)"
      const movesSummary = result.lines
        .map((line, i) => {
          const evalStr = line.mate
            ? `#${line.mate}`
            : (line.evaluation >= 0 ? `+${line.evaluation.toFixed(1)}` : line.evaluation.toFixed(1));
          return `${i + 1}. ${line.moves[0]} (${evalStr})`;
        })
        .join(' ');

      // Format timing: ms if < 1s, otherwise seconds
      const formatTime = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;

      logger.info('analysis_complete', clientInfo.email, {
        lines: result.lines.length,
        depth: result.depth,
        warmup: result.timing ? formatTime(result.timing.warmup) : '0ms',
        analysis: result.timing ? formatTime(result.timing.analysis) : 'N/A',
        total: result.timing ? formatTime(result.timing.total) : 'N/A',
        summary: movesSummary,
      });

      this.metrics.incrementSuggestions(result.lines.length);
      telemetry.recordSuggestion(result.depth);
      this.send(ws, result);
    } catch (err) {
      logger.error('analysis_error', clientInfo.email, err instanceof Error ? err : String(err));
      this.send(ws, {
        type: 'error',
        message: err instanceof Error ? err.message : 'Analysis failed',
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

    logger.info('auth_request', clientInfo.email);

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

// Start server
new ChessServer(PORT);
