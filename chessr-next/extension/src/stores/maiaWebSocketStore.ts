/**
 * Maia WebSocket Store (Zustand)
 * Exposes local Maia-2 connection state to React components
 */

import { create } from 'zustand';
import { maiaWebSocketManager } from '../lib/maiaWebSocket';

interface MaiaWebSocketState {
  isConnected: boolean;
  isConnecting: boolean;

  connect: () => void;
  disconnect: () => void;
}

export const useMaiaWebSocketStore = create<MaiaWebSocketState>((set) => {
  maiaWebSocketManager.onConnect(() => {
    set({ isConnected: true, isConnecting: false });
  });

  maiaWebSocketManager.onDisconnect(() => {
    set({ isConnected: false, isConnecting: false });
  });

  return {
    isConnected: false,
    isConnecting: false,

    connect: () => {
      set({ isConnecting: true });
      maiaWebSocketManager.connect();
    },

    disconnect: () => {
      maiaWebSocketManager.disconnect();
    },
  };
});
