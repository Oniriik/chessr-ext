import { AnalysisResult, InfoUpdate, Settings } from '../shared/types';
import { getCurrentVersion } from '../shared/version';

export interface VersionInfo {
  minVersion: string;
  downloadUrl?: string;
}

type MessageHandler = (message: AnalysisResult | InfoUpdate) => void;
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
          console.log('[Chessr WS] Connection opened');
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
          console.log('[Chessr WS] Connection closed. Code:', event.code, 'Reason:', event.reason);
          this.isConnected = false;
          this.notifyConnection(false);

          // Don't reconnect on auth errors (token expired/invalid)
          if (event.code === 4001) {
            console.log('[Chessr WS] Auth error - not reconnecting. Please re-login.');
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

  analyze(fen: string, settings: Settings, effectiveElo?: number) {
    console.log('[Chessr WS] Sending analyze request:', fen);
    this.send({
      type: 'analyze',
      fen,
      searchMode: settings.searchMode,
      depth: settings.depth,
      moveTime: settings.moveTime,
      elo: effectiveElo ?? settings.targetElo,
      mode: settings.mode,
      multiPV: settings.multiPV,
    });
  }

  stop() {
    this.send({ type: 'stop' });
  }

  updateSettings(settings: Partial<Settings>) {
    if (settings.targetElo !== undefined || settings.mode !== undefined) {
      this.send({
        type: 'settings',
        elo: settings.targetElo,
        mode: settings.mode,
      });
    }
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.push(handler);
  }

  onConnectionChange(handler: ConnectionHandler) {
    this.connectionHandlers.push(handler);
    // Immediately notify of current state
    handler(this.isConnected);
  }

  onVersionInfo(handler: VersionHandler) {
    this.versionHandlers.push(handler);
  }

  onVersionError(handler: VersionErrorHandler) {
    this.versionErrorHandlers.push(handler);
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  private send(message: object) {
    console.log('[Chessr WS] send() called, ws exists:', !!this.ws, 'readyState:', this.ws?.readyState);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const data = JSON.stringify(message);
      console.log('[Chessr WS] Sending data:', data);
      this.ws.send(data);
      console.log('[Chessr WS] Data sent successfully');
    } else {
      console.error('[Chessr WS] Cannot send - WebSocket not open. ReadyState:', this.ws?.readyState);
    }
  }

  private handleMessage(message: any) {
    console.log('[Chessr WS] Message received:', message.type, message);
    if (message.type === 'result' || message.type === 'info') {
      console.log('[Chessr WS] Dispatching to handlers:', this.messageHandlers.length, 'handlers');
      this.messageHandlers.forEach(handler => handler(message));
    } else if (message.type === 'auth_success') {
      console.log('[Chessr WS] Authentication successful:', message.user?.email);
    } else if (message.type === 'version_error') {
      console.log('[Chessr WS] Version error - update required:', message.minVersion);
      this.versionErrorOccurred = true;
      this.versionErrorHandlers.forEach(handler => handler({
        minVersion: message.minVersion,
        downloadUrl: message.downloadUrl,
      }));
    } else if (message.type === 'error') {
      console.error('Chessr: Server error:', message.message);
    } else {
      console.log('[Chessr WS] Unknown message type:', message.type);
    }
  }

  private notifyConnection(connected: boolean) {
    this.connectionHandlers.forEach(handler => handler(connected));
  }

  private async sendAuthToken() {
    try {
      // Get Supabase session from Chrome storage
      const result = await chrome.storage.local.get('chessr-auth');
      const authData = result['chessr-auth'];
      const version = getCurrentVersion();

      if (authData) {
        const session = JSON.parse(authData);
        if (session.access_token) {
          console.log('[Chessr WS] Sending auth token with version:', version);
          this.send({
            type: 'auth',
            token: session.access_token,
            version,
          });
        } else {
          console.log('[Chessr WS] No access token found in session, sending version only');
          this.send({
            type: 'auth',
            token: '',
            version,
          });
        }
      } else {
        console.log('[Chessr WS] No auth data found, sending version only');
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

  resetAuthError() {
    this.authErrorOccurred = false;
  }

  private scheduleReconnect() {
    // Don't reconnect if version error occurred
    if (this.versionErrorOccurred) {
      console.log('[Chessr WS] Not reconnecting due to version error');
      return;
    }

    // Don't reconnect if auth error occurred
    if (this.authErrorOccurred) {
      console.log('[Chessr WS] Not reconnecting due to auth error');
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
