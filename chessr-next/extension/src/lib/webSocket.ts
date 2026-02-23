/**
 * WebSocket Manager
 * Handles connection, authentication, reconnection and inactivity detection
 */

import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useAccuracyStore } from '../stores/accuracyStore';
import { logger } from './logger';

type MessageHandler = (data: unknown) => void;
type ConnectionHandler = () => void;

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
const INACTIVITY_DELAY = 2 * 60 * 1000; // 2 minutes
const MAX_RECONNECT_ATTEMPTS = 5;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();

  // Connection state
  private _isConnected = false;
  private _isConnecting = false;

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Inactivity
  private inactivityTimeout: ReturnType<typeof setTimeout> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private gameStoreUnsubscribe: (() => void) | null = null;
  private puzzleStoreUnsubscribe: (() => void) | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isConnecting(): boolean {
    return this._isConnecting;
  }

  /**
   * Initialize event listeners for activity detection
   */
  init(): void {
    // Listen for tab visibility changes
    this.visibilityHandler = () => this.checkActivity();
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // Subscribe to game store changes
    let prevIsGameStarted = useGameStore.getState().isGameStarted;
    this.gameStoreUnsubscribe = useGameStore.subscribe((state) => {
      if (state.isGameStarted !== prevIsGameStarted) {
        prevIsGameStarted = state.isGameStarted;
        this.checkActivity();
      }
    });

    // Subscribe to puzzle store changes
    let prevIsPuzzleStarted = usePuzzleStore.getState().isStarted;
    this.puzzleStoreUnsubscribe = usePuzzleStore.subscribe((state) => {
      if (state.isStarted !== prevIsPuzzleStarted) {
        prevIsPuzzleStarted = state.isStarted;
        this.checkActivity();
      }
    });
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    if (this.gameStoreUnsubscribe) {
      this.gameStoreUnsubscribe();
    }
    if (this.puzzleStoreUnsubscribe) {
      this.puzzleStoreUnsubscribe();
    }
    this.disconnect();
  }

  /**
   * Check if client is active and manage connection accordingly
   */
  checkActivity(): void {
    const isTabVisible = !document.hidden;
    const isGameActive = useGameStore.getState().isGameStarted;
    const isPuzzleActive = usePuzzleStore.getState().isStarted;
    const hasUser = !!useAuthStore.getState().user;

    if (!hasUser) {
      // Not authenticated, don't connect
      this.cancelInactivityTimeout();
      this.disconnect();
      return;
    }

    if (isTabVisible && (isGameActive || isPuzzleActive)) {
      // Client is active (game or puzzle)
      this.cancelInactivityTimeout();

      // Reconnect if disconnected
      if (!this._isConnected && !this._isConnecting) {
        this.connect();
      }
    } else {
      // Client is inactive, schedule disconnect
      this.scheduleDisconnect();
    }
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this._isConnected || this._isConnecting) {
      return;
    }

    const session = useAuthStore.getState().session;
    const token = session?.access_token;

    if (!token) {
      logger.log('No token available, skipping connection');
      return;
    }

    this._isConnecting = true;

    return new Promise((resolve, reject) => {
      logger.log('Connecting to', WS_URL);
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        logger.log('Connection opened, authenticating...');
        this.send({ type: 'auth', token });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'auth_success') {
            logger.log('Authenticated successfully');
            this._isConnected = true;
            this._isConnecting = false;
            this.reconnectAttempts = 0;
            this.connectHandlers.forEach((h) => h());
            resolve();
          } else if (data.type === 'auth_error') {
            logger.error('Authentication failed:', data.error);
            this._isConnecting = false;
            this.ws?.close();
            reject(new Error(data.error));
          } else if (data.type === 'ping') {
            // Respond to heartbeat
            this.send({ type: 'pong' });
          } else if (data.type === 'suggestion_result') {
            // Handle suggestion response
            logger.log(
              `Received ${data.suggestions?.length || 0} suggestions for requestId: ${data.requestId}, eval: ${data.positionEval}, mate: ${data.mateIn}, winRate: ${data.winRate}`
            );

            // Route to puzzle store if puzzle mode, otherwise to suggestion store
            if (data.puzzleMode && data.suggestions?.length > 0) {
              usePuzzleStore
                .getState()
                .receiveSuggestions(
                  data.requestId,
                  data.suggestions.map((s: { move: string; evaluation?: number; winRate?: number }) => ({
                    move: s.move,
                    evaluation: s.evaluation,
                    winRate: s.winRate,
                  }))
                );
            } else {
              useSuggestionStore
                .getState()
                .receiveSuggestions(data.requestId, data.fen, data.positionEval, data.mateIn, data.winRate, data.suggestions);
            }
          } else if (data.type === 'suggestion_error') {
            // Handle suggestion error
            useSuggestionStore
              .getState()
              .receiveError(data.requestId, data.error);
          } else if (data.type === 'analysis_result') {
            // Handle analysis response
            logger.log(
              `Received analysis: ${data.classification} (CPL: ${data.cpl}, eval: ${data.evalAfter})`
            );
            useAccuracyStore.getState().receiveAnalysis(data.requestId, {
              move: data.move,
              classification: data.classification,
              cpl: data.cpl,
              accuracyImpact: data.accuracyImpact,
              weightedImpact: data.weightedImpact,
              phase: data.phase,
              bestMove: data.bestMove,
              evalAfter: data.evalAfter,
              mateInAfter: data.mateInAfter,
            });
          } else if (data.type === 'analysis_error') {
            // Handle analysis error
            useAccuracyStore
              .getState()
              .receiveError(data.requestId, data.error);
          } else {
            // Dispatch to message handlers
            this.messageHandlers.forEach((h) => h(data));
          }
        } catch (err) {
          logger.error('Error parsing message:', err);
        }
      };

      this.ws.onclose = (event) => {
        logger.log('Connection closed:', event.code, event.reason);
        this._isConnected = false;
        this._isConnecting = false;
        this.disconnectHandlers.forEach((h) => h());

        // Only attempt reconnect if not a voluntary disconnect (code 1000)
        // and we haven't exceeded max attempts
        if (event.code !== 1000 && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        logger.error('WebSocket error:', err);
        this._isConnecting = false;
      };
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.cancelReconnect();
    this.cancelInactivityTimeout();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this._isConnected = false;
    this._isConnecting = false;
  }

  /**
   * Send a message to the server
   */
  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Register a connect handler
   */
  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  /**
   * Register a disconnect handler
   */
  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  // --- Private methods ---

  private scheduleDisconnect(): void {
    if (this.inactivityTimeout) return; // Already scheduled

    logger.log('Scheduling disconnect due to inactivity');
    this.inactivityTimeout = setTimeout(() => {
      logger.log('Disconnecting due to inactivity');
      this.disconnect();
    }, INACTIVITY_DELAY);
  }

  private cancelInactivityTimeout(): void {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
    logger.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
  }
}

// Singleton instance
export const webSocketManager = new WebSocketManager();
