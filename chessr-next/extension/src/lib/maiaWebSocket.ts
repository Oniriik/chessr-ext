/**
 * Maia WebSocket Manager
 * Connects to the local Maia-2 wrapper (ws://localhost:8765)
 * Handles authentication state from the Maia desktop app.
 */

import { useSuggestionStore } from '../stores/suggestionStore';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useMaiaWebSocketStore } from '../stores/maiaWebSocketStore';
import { logger } from './logger';

type ConnectionHandler = () => void;

const MAIA_DEFAULT_URL = 'ws://127.0.0.1:8765';
const RECONNECT_INTERVAL = 3000;
const PING_INTERVAL = 10000;

class MaiaWebSocketManager {
  private ws: WebSocket | null = null;
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();

  private _isConnected = false;
  private _isConnecting = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _shouldReconnect = false;

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isConnecting(): boolean {
    return this._isConnecting;
  }

  /**
   * Connect to the local Maia WebSocket server
   */
  connect(url = MAIA_DEFAULT_URL): void {
    if (this._isConnected || this._isConnecting) return;

    this._isConnecting = true;
    this._shouldReconnect = true;

    logger.log(`[Maia] Connecting to ${url}`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      logger.log('[Maia] Connected');
      this._isConnected = true;
      this._isConnecting = false;
      this.connectHandlers.forEach((h) => h());
      this.startPing();
      // Auto-request auth status on connect
      this.requestAuth();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        logger.error('[Maia] Error parsing message:', err);
      }
    };

    this.ws.onclose = () => {
      logger.log('[Maia] Disconnected');
      this._isConnected = false;
      this._isConnecting = false;
      this.stopPing();
      this.disconnectHandlers.forEach((h) => h());

      if (this._shouldReconnect) {
        this.scheduleReconnect(url);
      }
    };

    this.ws.onerror = () => {
      this._isConnecting = false;
    };
  }

  /**
   * Disconnect from Maia server
   */
  disconnect(): void {
    this._shouldReconnect = false;
    this.cancelReconnect();
    this.stopPing();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this._isConnected = false;
    this._isConnecting = false;
  }

  /**
   * Send a suggestion request to Maia
   */
  sendSuggestion(requestId: string, fen: string, eloSelf: number, eloOppo: number, topN = 5): void {
    this.send({
      type: 'analyze',
      requestId,
      fen,
      elo_self: eloSelf,
      elo_oppo: eloOppo,
      top_n: topN,
    });
  }

  /**
   * Request the current auth status from Maia server
   */
  requestAuth(): void {
    this.send({ type: 'get_auth' });
  }

  /**
   * Login to Maia using tokens from the extension's Supabase session
   */
  loginWithToken(accessToken: string, refreshToken: string): void {
    this.send({
      type: 'login_with_token',
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  // --- Private ---

  private handleMessage(data: Record<string, unknown>): void {
    if (data.type === 'pong') return;

    if (data.type === 'auth_status') {
      const loggedIn = data.logged_in as boolean;
      if (loggedIn) {
        useMaiaWebSocketStore.getState().setMaiaAuth(
          data.email as string,
          data.plan as string,
        );
      } else {
        useMaiaWebSocketStore.getState().clearMaiaAuth();
      }
      return;
    }

    if (data.type === 'auth_required') {
      const requestId = data.requestId as string;
      if (requestId) {
        useSuggestionStore.getState().receiveError(requestId, 'Login required in Maia app');
      }
      return;
    }

    if (data.type === 'upgrade_required') {
      const requestId = data.requestId as string;
      if (requestId) {
        useSuggestionStore.getState().receiveError(requestId, 'Upgrade your plan to use Maia engine');
      }
      return;
    }

    if (data.type === 'analysis_result') {
      const moves = data.moves as Array<{ move: string; probability: number }>;
      const winProb = data.win_prob as number;
      const requestId = data.requestId as string;
      const fen = data.fen as string;
      const isPuzzle = requestId.startsWith('puzzle-');

      // Maia returns win_prob from side-to-move's perspective
      // SuggestionStore expects white's perspective
      const isBlackToMove = fen.includes(' b ');
      const winProbWhite = isBlackToMove ? 1 - winProb : winProb;

      const positionEval = winProbToEval(winProbWhite);
      const winRateWhitePct = Math.round(winProbWhite * 100);

      if (isPuzzle) {
        // Route to puzzle store
        const puzzleSuggestions = moves.map((m) => ({
          move: m.move,
          evaluation: Math.round(positionEval * 100),
          winRate: winRateWhitePct,
        }));
        usePuzzleStore.getState().receiveSuggestions(requestId, puzzleSuggestions);
      } else {
        // Route to game suggestion store (all values in white's POV)
        const suggestions = moves.map((m) => ({
          move: m.move,
          evaluation: Math.round(positionEval * 100),
          depth: 0,
          winRate: winRateWhitePct,
          drawRate: 0,
          lossRate: 100 - winRateWhitePct,
          confidence: m.probability,
          confidenceLabel: probabilityToLabel(m.probability),
          pv: [m.move],
        }));

        useSuggestionStore.getState().receiveSuggestions(
          requestId,
          fen,
          positionEval,
          null,
          winRateWhitePct,
          suggestions,
        );
      }
    } else if (data.type === 'error') {
      const requestId = data.requestId as string;
      if (requestId) {
        if (requestId.startsWith('puzzle-')) {
          // Puzzle errors: just log, puzzle store doesn't have receiveError
          logger.error(`[Maia] Puzzle error: ${data.message}`);
        } else {
          useSuggestionStore.getState().receiveError(requestId, data.message as string);
        }
      }
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(url: string): void {
    this.reconnectTimeout = setTimeout(() => {
      this.connect(url);
    }, RECONNECT_INTERVAL);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

/**
 * Map probability to confidence label
 */
function probabilityToLabel(prob: number) {
  if (prob >= 0.3) return 'very_reliable' as const;
  if (prob >= 0.15) return 'reliable' as const;
  if (prob >= 0.08) return 'playable' as const;
  if (prob >= 0.03) return 'risky' as const;
  return 'speculative' as const;
}

/**
 * Rough win probability to centipawn eval conversion
 */
function winProbToEval(winProb: number): number {
  // Logistic formula inverse: eval = -log((1/wp) - 1) / k
  const clamped = Math.max(0.01, Math.min(0.99, winProb));
  return Math.round((-Math.log(1 / clamped - 1) / 0.004) / 100) / 100;
}

// Singleton
export const maiaWebSocketManager = new MaiaWebSocketManager();
