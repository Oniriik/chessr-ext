import { WebSocketServer, WebSocket } from 'ws';
import { StockfishPool } from './stockfish-pool.js';
import { ClientMessage, ServerMessage } from './types.js';

const PORT = 3000;

// Pool configuration - auto-scales based on demand
const POOL_CONFIG = {
  minEngines: 2,      // Always keep at least 2 engines ready
  maxEngines: 8,      // Never exceed 8 engines
  scaleUpThreshold: 2, // Scale up when 2+ requests are queued
  scaleDownIdleTime: 60000, // Scale down after 1 min of inactivity
  engineOptions: { threads: 2, hash: 64 },
};

class ChessServer {
  private wss: WebSocketServer;
  private pool: StockfishPool;
  private clients = new Set<WebSocket>();

  constructor(port: number) {
    this.pool = new StockfishPool(POOL_CONFIG);
    this.wss = new WebSocketServer({ port });

    this.init(port);
  }

  private async init(port: number) {
    try {
      await this.pool.init();
      console.log(`Chess Stockfish Server running on ws://localhost:${port}`);
      console.log(`Pool: ${POOL_CONFIG.minEngines}-${POOL_CONFIG.maxEngines} engines (auto-scaling)`);

      this.wss.on('connection', (ws) => this.handleConnection(ws));
    } catch (err) {
      console.error('Failed to initialize server:', err);
      process.exit(1);
    }
  }

  private handleConnection(ws: WebSocket) {
    console.log('Client connected');
    this.clients.add(ws);

    this.send(ws, { type: 'ready' });

    ws.on('message', (data) => this.handleMessage(ws, data.toString()));

    ws.on('close', () => {
      console.log('Client disconnected');
      this.clients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  }

  private async handleMessage(ws: WebSocket, rawData: string) {
    let message: ClientMessage;
    try {
      message = JSON.parse(rawData);
      console.log('[Server] Message received:', message.type, message);
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (message.type) {
      case 'analyze':
        await this.handleAnalyze(ws, message);
        break;

      default:
        console.log('[Server] Unknown message type:', message.type);
        this.send(ws, { type: 'error', message: 'Unknown message type' });
    }
  }

  private async handleAnalyze(
    ws: WebSocket,
    message: ClientMessage & { type: 'analyze' }
  ): Promise<void> {
    console.log('[Server] Starting analysis for FEN:', message.fen);
    try {
      const result = await this.pool.analyze(
        message.fen,
        {
          searchMode: message.searchMode || 'depth',
          depth: message.depth,
          moveTime: message.moveTime || 1000,
          multiPV: message.multiPV,
          elo: message.elo,
          mode: message.mode || 'balanced',
        },
        (info) => {
          console.log('[Server] Sending info update:', info);
          this.send(ws, info);
        }
      );

      console.log('[Server] Analysis complete, sending result:', result);
      this.send(ws, result);
    } catch (err) {
      console.error('[Server] Analysis error:', err);
      this.send(ws, {
        type: 'error',
        message: err instanceof Error ? err.message : 'Analysis failed',
      });
    }
  }

  private send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      console.log('[Server] Sending message:', message.type);
      ws.send(JSON.stringify(message));
    } else {
      console.log('[Server] Cannot send message, WebSocket not open:', ws.readyState);
    }
  }
}

// Start server
new ChessServer(PORT);
