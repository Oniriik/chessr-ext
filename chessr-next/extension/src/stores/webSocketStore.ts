/**
 * WebSocket Store (Zustand)
 * Exposes WebSocket connection state to React components
 */

import { create } from 'zustand';
import { webSocketManager } from '../lib/webSocket';

interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;

  // Actions
  init: () => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  send: (message: object) => void;
  destroy: () => void;
}

export const useWebSocketStore = create<WebSocketState>((set) => {
  // Subscribe to WebSocket manager events
  webSocketManager.onConnect(() => {
    set({ isConnected: true, isConnecting: false, error: null });
  });

  webSocketManager.onDisconnect(() => {
    set({ isConnected: false, isConnecting: false });
  });

  return {
    isConnected: false,
    isConnecting: false,
    error: null,

    init: () => {
      webSocketManager.init();
    },

    connect: async () => {
      set({ isConnecting: true, error: null });
      try {
        await webSocketManager.connect();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection failed';
        set({ isConnecting: false, error: message });
      }
    },

    disconnect: () => {
      webSocketManager.disconnect();
    },

    send: (message: object) => {
      webSocketManager.send(message);
    },

    destroy: () => {
      webSocketManager.destroy();
    },
  };
});
