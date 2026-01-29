/**
 * Presentation: App Store (Zustand)
 */

import { create } from 'zustand';
import { Settings, AnalysisResult, BoardConfig } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { settingsRepository } from '../../infrastructure/repository/settings.repository';
import { cloudSettingsRepository } from '../../infrastructure/repository/cloud-settings.repository';
import { detectBoard } from '../../content/board-detector';

const SIDEBAR_OPEN_KEY = 'chessr_sidebar_open';

// Load sidebar state from localStorage (default: true)
const loadSidebarState = (): boolean => {
  try {
    const stored = localStorage.getItem(SIDEBAR_OPEN_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};

// Save sidebar state to localStorage only
const saveSidebarState = (isOpen: boolean): void => {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, String(isOpen));
  } catch {
    // Ignore storage errors
  }
};

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

  // UI
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Page state
  isGamePage: boolean;
  setIsGamePage: (isGamePage: boolean) => void;

  // Last game info (for review page)
  lastGamePlayerColor: 'white' | 'black' | null;
  setLastGamePlayerColor: (color: 'white' | 'black' | null) => void;

  // Side to move
  sideToMove: 'w' | 'b' | null;
  setSideToMove: (side: 'w' | 'b' | null) => void;

  // Re-detect turn trigger (only analyzes if turn changed)
  redetectTurnCount: number;
  requestTurnRedetect: () => void;

  // Re-analyze trigger
  reanalyzeCount: number;
  requestReanalyze: () => void;

  // Version check
  updateRequired: boolean;
  updateDismissed: boolean;
  minVersion: string | null;
  downloadUrl: string | null;
  setUpdateRequired: (required: boolean, minVersion: string, downloadUrl?: string) => void;
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
    set({ settings: localSettings });

    // If user is logged in, sync with cloud
    if (userId) {
      const cloudSettings = await cloudSettingsRepository.sync(userId, localSettings);
      set({ settings: cloudSettings });
      // Update local storage with cloud settings
      await settingsRepository.save(cloudSettings);
    }
  },
  syncWithCloud: async (userId) => {
    const localSettings = get().settings;
    const cloudSettings = await cloudSettingsRepository.sync(userId, localSettings);
    set({ settings: cloudSettings });
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
    const current = get().boardConfig;
    // Only update if color actually changed
    if (detected && detected.playerColor !== current?.playerColor) {
      set({ boardConfig: detected });
    }
  },

  // UI - sidebarOpen persists only in localStorage, not in database
  sidebarOpen: loadSidebarState(),
  toggleSidebar: () => {
    const newState = !get().sidebarOpen;
    set({ sidebarOpen: newState });
    saveSidebarState(newState);
  },

  // Page state
  isGamePage: false,
  setIsGamePage: (isGamePage) => {
    // When leaving a game page, save the player color
    if (!isGamePage && get().isGamePage && get().boardConfig) {
      set({ lastGamePlayerColor: get().boardConfig!.playerColor });
    }
    set({ isGamePage });
  },

  // Last game info
  lastGamePlayerColor: null,
  setLastGamePlayerColor: (color) => set({ lastGamePlayerColor: color }),

  // Side to move
  sideToMove: null,
  setSideToMove: (side) => set({ sideToMove: side }),

  // Re-detect turn trigger (only analyzes if turn changed)
  redetectTurnCount: 0,
  requestTurnRedetect: () => set((state) => ({ redetectTurnCount: state.redetectTurnCount + 1 })),

  // Re-analyze trigger
  reanalyzeCount: 0,
  requestReanalyze: () => set((state) => ({ reanalyzeCount: state.reanalyzeCount + 1 })),

  // Version check
  updateRequired: false,
  updateDismissed: false,
  minVersion: null,
  downloadUrl: null,
  setUpdateRequired: (required, minVersion, downloadUrl) => {
    set({ updateRequired: required, minVersion, downloadUrl: downloadUrl ?? null, updateDismissed: false });
  },
  dismissUpdate: () => {
    set({ updateDismissed: true });
  },
}));
