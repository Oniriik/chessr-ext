/**
 * WebSocket Manager
 * Handles connection, authentication and reconnection
 */

import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useAccuracyStore } from '../stores/accuracyStore';
import { useLinkedAccountsStore, type LinkedAccount, type LinkErrorCode } from '../stores/linkedAccountsStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { useDiscordStore } from '../stores/discordStore';
import { logger } from './logger';

type MessageHandler = (data: unknown) => void;
type ConnectionHandler = () => void;

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
const MAX_RECONNECT_ATTEMPTS = 5;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();

  // Opening request callbacks
  openingCallbacks: Map<string, (data: unknown) => void> = new Map();

  // Connection state
  private _isConnected = false;
  private _isConnecting = false;
  private _voluntaryDisconnect = false;

  // Reconnection
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private visibilityHandler: (() => void) | null = null;
  private gameStoreUnsubscribe: (() => void) | null = null;
  private puzzleStoreUnsubscribe: (() => void) | null = null;
  private authStoreUnsubscribe: (() => void) | null = null;

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

    // Subscribe to auth store changes - disconnect when user signs out
    let prevUser = useAuthStore.getState().user;
    this.authStoreUnsubscribe = useAuthStore.subscribe((state) => {
      if (prevUser && !state.user) {
        // User signed out - disconnect WebSocket
        logger.log('User signed out, disconnecting WebSocket');
        this.disconnect();
      }
      prevUser = state.user;
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
    if (this.authStoreUnsubscribe) {
      this.authStoreUnsubscribe();
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
      this.disconnect();
      return;
    }

    if (isTabVisible && (isGameActive || isPuzzleActive)) {
      // Client is active (game or puzzle) - reconnect if needed
      if (!this._isConnected && !this._isConnecting) {
        this.connect();
      }
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

            // Update maintenance schedule from server
            const maint = data.maintenanceSchedule;
            useMaintenanceStore.getState().setSchedule(maint?.start || null, maint?.end || null);

            // Update Discord link status from server
            const discordStore = useDiscordStore.getState();
            discordStore.setLinked(!!data.discordLinked, data.discordUsername || null, data.discordAvatar || null);
            discordStore.setFreetrialUsed(!!data.freetrialUsed);
            discordStore.setInGuild(!!data.discordInGuild);

            resolve();
          } else if (data.type === 'auth_error') {
            logger.error('Authentication failed:', data.error);
            this._isConnecting = false;
            this.ws?.close();
            reject(new Error(data.error));
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
          } else if (data.type === 'linked_accounts') {
            // Handle linked accounts list
            logger.log(`Received ${data.accounts?.length || 0} linked accounts`);
            const store = useLinkedAccountsStore.getState();
            store.setAccounts(data.accounts || []);
            // Don't set needsLinking here - let useLinkingCheck handle it
            // The server doesn't know the current platform context
            store.setLoading(false);
          } else if (data.type === 'link_account_success') {
            // Handle successful account link
            logger.log(`Linked account: ${data.account?.platformUsername}`);
            const store = useLinkedAccountsStore.getState();
            store.addAccount(data.account as LinkedAccount);
            store.setPendingProfile(null);
            store.setLoading(false);
          } else if (data.type === 'link_account_error') {
            // Handle account link error
            logger.error('Link account error:', data.error);
            const store = useLinkedAccountsStore.getState();
            store.setLinkError({
              message: data.error,
              code: data.code as LinkErrorCode,
              hoursRemaining: data.hoursRemaining,
            });
            store.setLoading(false);
          } else if (data.type === 'unlink_account_success') {
            // Handle successful account unlink
            logger.log(`Unlinked account: ${data.accountId}`);
            const store = useLinkedAccountsStore.getState();

            store.removeAccount(data.accountId);
            store.setLoading(false);

            // All users need to re-check after unlink (premium users included, they just don't have cooldown)
            // Set needsLinking to true - this triggers the re-check in useLinkingCheck
            // If remaining accounts include the current platform, the hook will set it back to false
            store.setNeedsLinking(true);
          } else if (data.type === 'linked_accounts_error' || data.type === 'unlink_account_error') {
            // Handle linked accounts errors
            logger.error('Linked accounts error:', data.error);
            useLinkedAccountsStore.getState().setLoading(false);
          } else if (data.type === 'cooldown_status') {
            // Handle cooldown check response
            const store = useLinkedAccountsStore.getState();
            if (data.hasCooldown) {
              logger.log(`Cooldown active: ${data.hoursRemaining}h remaining`);
              store.setCooldownHours(data.hoursRemaining || 48);
            } else {
              store.setCooldownHours(null);
            }
            store.setLoading(false);
          } else if (data.type === 'discord_link_url') {
            // Redirect to Discord OAuth on same page
            logger.log('Redirecting to Discord OAuth');
            window.location.href = data.url;
          } else if (data.type === 'discord_link_error') {
            logger.error('Discord link error:', data.error);
            useDiscordStore.getState().setLinking(false);
          } else if (data.type === 'banned') {
            // Server detected user is banned - force sign out
            logger.log('User banned by server:', data.reason);
            const authStore = useAuthStore.getState();
            authStore.signOut();
            useAuthStore.setState({ error: `Banned: ${data.reason || 'Your account has been banned.'}` });
            this.disconnect();
          } else if (data.type === 'opening_result' || data.type === 'opening_error') {
            // Handle opening data response - dispatch to pending callbacks
            const callback = this.openingCallbacks.get(data.requestId);
            if (callback) {
              this.openingCallbacks.delete(data.requestId);
              callback(data);
            }
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

        // Reconnect unless this was a voluntary client disconnect
        if (!this._voluntaryDisconnect && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect();
        }
        this._voluntaryDisconnect = false;
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
    this._voluntaryDisconnect = true;

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
