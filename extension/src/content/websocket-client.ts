import { Settings } from '../shared/types';
import {
  SuggestionResult,
  SuggestionError,
  AnalysisNewResult,
  AnalysisNewError,
} from '../domain/analysis/feedback-types';
import { getCurrentVersion } from '../shared/version';

export interface VersionInfo {
  minVersion: string;
  downloadUrl?: string;
}

type MessageHandler = (message: SuggestionResult | SuggestionError | AnalysisNewResult | AnalysisNewError) => void;
type ConnectionHandler = (connected: boolean) => void;
type VersionHandler = (version: VersionInfo) => void;
type VersionErrorHandler = (version: VersionInfo) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private messageHandlers: MessageHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private versionHandlers: VersionHandler[] = [];
  private versionErrorHandlers: VersionErrorHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isConnected = false;
  private versionErrorOccurred = false;
  private authErrorOccurred = false;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.notifyConnection(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);

            // Resolve on ready message and send auth token
            if (message.type === 'ready') {
              // Notify version handlers if version info is present
              if (message.version) {
                this.versionHandlers.forEach(handler => handler(message.version));
              }
              this.sendAuthToken();
              resolve();
            }
          } catch (err) {
            console.error('Failed to parse message:', err);
          }
        };

        this.ws.onclose = (event) => {
          this.isConnected = false;
          this.notifyConnection(false);

          // Don't reconnect on auth errors (token expired/invalid)
          if (event.code === 4001) {
            this.authErrorOccurred = true;
            return;
          }

          this.scheduleReconnect();
        };

        this.ws.onerror = (event) => {
          console.error('[Chessr WS] WebSocket error:', event);
          reject(new Error('WebSocket connection failed'));
        };

      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Request suggestions for a position.
   * Uses FEN directly instead of replaying all moves.
   */
  suggestion(
    fen: string,
    moves: string[],
    settings: Settings,
    requestId: string
  ) {
    this.send({
      type: 'suggestion',
      requestId,
      fen,
      moves,
      targetElo: settings.targetElo,
      personality: settings.personality,
      armageddon: settings.armageddon,
      multiPv: settings.multiPV,
      contempt: settings.riskTaking,
      skill: settings.skill,
    });
  }

  /**
   * Request move analysis using new architecture.
   * Independent analysis using fenBefore/fenAfter.
   */
  analyzeNew(
    fenBefore: string,
    fenAfter: string,
    move: string,
    moves: string[],
    playerColor: 'w' | 'b',
    targetElo: number,
    requestId: string
  ) {
    this.send({
      type: 'analyze_new',
      requestId,
      fenBefore,
      fenAfter,
      move,
      moves,
      playerColor,
      targetElo,
    });
  }

  stop() {
    this.send({ type: 'stop' });
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.push(handler);
  }

  onConnectionChange(handler: ConnectionHandler) {
    this.connectionHandlers.push(handler);
    // Immediately notify of current state
    handler(this.isConnected);
  }

  onVersionError(handler: VersionErrorHandler) {
    this.versionErrorHandlers.push(handler);
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  private send(message: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('[Chessr WS] Cannot send - WebSocket not open');
    }
  }

  private handleMessage(message: any) {
    if (
      message.type === 'suggestion_result' ||
      message.type === 'suggestion_error' ||
      message.type === 'analysis_result' ||
      message.type === 'analysis_error'
    ) {
      this.messageHandlers.forEach(handler => handler(message));
    } else if (message.type === 'auth_success') {
      // Auth successful
    } else if (message.type === 'version_error') {
      console.log('[Chessr WS] Version error - update required:', message.minVersion);
      this.versionErrorOccurred = true;
      this.versionErrorHandlers.forEach(handler => handler({
        minVersion: message.minVersion,
        downloadUrl: message.downloadUrl,
      }));
    } else if (message.type === 'error') {
      console.error('Chessr: Server error:', message.message);
    }
  }

  private notifyConnection(connected: boolean) {
    this.connectionHandlers.forEach(handler => handler(connected));
  }

  private async sendAuthToken() {
    try {
      const result = await chrome.storage.local.get('chessr-auth');
      const authData = result['chessr-auth'];
      const version = getCurrentVersion();

      if (authData) {
        const session = JSON.parse(authData);
        this.send({
          type: 'auth',
          token: session.access_token || '',
          version,
        });
      } else {
        this.send({
          type: 'auth',
          token: '',
          version,
        });
      }
    } catch (err) {
      console.error('[Chessr WS] Failed to send auth token:', err);
    }
  }

  private scheduleReconnect() {
    if (this.versionErrorOccurred || this.authErrorOccurred) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect will be scheduled on close
      });
    }, delay);
  }
}
