/**
 * Presentation: App Store (Zustand)
 */

import { create } from 'zustand';
import { Settings, AnalysisResult, BoardConfig } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { settingsRepository } from '../../infrastructure/repository/settings.repository';
import { cloudSettingsRepository } from '../../infrastructure/repository/cloud-settings.repository';
import { detectBoard } from '../../content/board-detector';

interface AppState {
  // Settings
  settings: Settings;
  setSettings: (settings: Partial<Settings>, userId?: string) => Promise<void>;
  loadSettings: (userId?: string) => Promise<void>;
  syncWithCloud: (userId: string) => Promise<void>;

  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;

  // Analysis
  analysis: AnalysisResult | null;
  setAnalysis: (analysis: AnalysisResult | null) => void;

  // Board
  boardConfig: BoardConfig | null;
  setBoardConfig: (config: BoardConfig | null) => void;
  togglePlayerColor: () => void;
  redetectPlayerColor: () => void;

  // Anti-cheat ELO offset
  eloOffset: number;
  setEloOffset: (offset: number) => void;

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Version check
  updateRequired: boolean;
  updateDismissed: boolean;
  minVersion: string | null;
  downloadUrl: string | null;
  setUpdateRequired: (required: boolean, minVersion: string, downloadUrl: string) => void;
  dismissUpdate: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Settings
  settings: DEFAULT_SETTINGS,
  setSettings: async (partial, userId) => {
    const newSettings = { ...get().settings, ...partial };
    set({ settings: newSettings });
    // Save locally
    await settingsRepository.save(partial);
    // Also save to cloud if user is logged in
    if (userId) {
      await cloudSettingsRepository.save(userId, partial);
    }
  },
  loadSettings: async (userId) => {
    // First load local settings
    const localSettings = await settingsRepository.get();
    set({ settings: localSettings, sidebarOpen: localSettings.sidebarOpen });

    // If user is logged in, sync with cloud
    if (userId) {
      const cloudSettings = await cloudSettingsRepository.sync(userId, localSettings);
      set({ settings: cloudSettings, sidebarOpen: cloudSettings.sidebarOpen });
      // Update local storage with cloud settings
      await settingsRepository.save(cloudSettings);
    }
  },
  syncWithCloud: async (userId) => {
    const localSettings = get().settings;
    const cloudSettings = await cloudSettingsRepository.sync(userId, localSettings);
    set({ settings: cloudSettings, sidebarOpen: cloudSettings.sidebarOpen });
    // Update local storage with cloud settings
    await settingsRepository.save(cloudSettings);
  },

  // Connection
  connected: false,
  setConnected: (connected) => set({ connected }),

  // Analysis
  analysis: null,
  setAnalysis: (analysis) => set({ analysis }),

  // Board
  boardConfig: null,
  setBoardConfig: (boardConfig) => set({ boardConfig }),
  togglePlayerColor: () => {
    const current = get().boardConfig;
    if (current) {
      const newColor = current.playerColor === 'white' ? 'black' : 'white';
      set({
        boardConfig: {
          ...current,
          playerColor: newColor,
          isFlipped: newColor === 'black',
        },
      });
    }
  },
  redetectPlayerColor: () => {
    const detected = detectBoard();
    if (detected) {
      set({ boardConfig: detected });
    }
  },

  // Anti-cheat ELO offset
  eloOffset: 0,
  setEloOffset: (eloOffset) => set({ eloOffset }),

  // UI
  sidebarOpen: true,
  toggleSidebar: () => {
    const newState = !get().sidebarOpen;
    set({ sidebarOpen: newState });
    settingsRepository.save({ sidebarOpen: newState });
  },

  // Version check
  updateRequired: false,
  updateDismissed: false,
  minVersion: null,
  downloadUrl: null,
  setUpdateRequired: (required, minVersion, downloadUrl) => {
    set({ updateRequired: required, minVersion, downloadUrl, updateDismissed: false });
  },
  dismissUpdate: () => {
    set({ updateDismissed: true });
  },
}));
