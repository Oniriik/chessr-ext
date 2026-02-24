/**
 * Version Store - Manages extension version checking
 * Update is mandatory - no dismiss option
 */

import { create } from 'zustand';
import { checkVersion, getCurrentVersion } from '../lib/version';

// Use same server URL as WebSocket
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';

interface VersionState {
  currentVersion: string;
  updateRequired: boolean;
  minVersion: string | null;
  downloadUrl: string | null;
  isChecking: boolean;

  // Actions
  checkVersion: () => Promise<void>;
}

export const useVersionStore = create<VersionState>((set) => ({
  currentVersion: getCurrentVersion(),
  updateRequired: false,
  minVersion: null,
  downloadUrl: null,
  isChecking: false,

  checkVersion: async () => {
    set({ isChecking: true });

    const result = await checkVersion(WS_URL);

    set({
      isChecking: false,
      updateRequired: result.updateRequired,
      currentVersion: result.currentVersion,
      minVersion: result.minVersion || null,
      downloadUrl: result.downloadUrl || null,
    });
  },
}));
