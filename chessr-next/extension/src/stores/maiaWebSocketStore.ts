/**
 * Maia WebSocket Store (Zustand)
 * Exposes local Maia-2 connection + auth state to React components
 */

import { create } from 'zustand';
import { maiaWebSocketManager } from '../lib/maiaWebSocket';
import { supabase } from '../lib/supabase';

interface MaiaWebSocketState {
  isConnected: boolean;
  isConnecting: boolean;

  // Auth state from Maia desktop app
  maiaLoggedIn: boolean;
  maiaEmail: string | null;
  maiaPlan: string | null;

  connect: () => void;
  disconnect: () => void;
  setMaiaAuth: (email: string, plan: string) => void;
  clearMaiaAuth: () => void;
  loginWithExtensionAccount: () => Promise<void>;
}

export const useMaiaWebSocketStore = create<MaiaWebSocketState>((set) => {
  maiaWebSocketManager.onConnect(() => {
    set({ isConnected: true, isConnecting: false });
  });

  maiaWebSocketManager.onDisconnect(() => {
    set({ isConnected: false, isConnecting: false, maiaLoggedIn: false, maiaEmail: null, maiaPlan: null });
  });

  return {
    isConnected: false,
    isConnecting: false,
    maiaLoggedIn: false,
    maiaEmail: null,
    maiaPlan: null,

    connect: () => {
      set({ isConnecting: true });
      maiaWebSocketManager.connect();
    },

    disconnect: () => {
      maiaWebSocketManager.disconnect();
    },

    setMaiaAuth: (email: string, plan: string) => {
      set({ maiaLoggedIn: true, maiaEmail: email, maiaPlan: plan });
    },

    clearMaiaAuth: () => {
      set({ maiaLoggedIn: false, maiaEmail: null, maiaPlan: null });
    },

    loginWithExtensionAccount: async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token && data.session?.refresh_token) {
        maiaWebSocketManager.loginWithToken(
          data.session.access_token,
          data.session.refresh_token,
        );
      }
    },
  };
});
