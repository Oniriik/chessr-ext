/**
 * Settings Store (Zustand)
 * Manages user preferences and settings
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  // Language
  language: string;

  // Display settings
  showGameStatistics: boolean;
  showDetailedMoveSuggestion: boolean;
  showEvalBar: boolean;

  // Actions
  setLanguage: (language: string) => void;
  setShowGameStatistics: (show: boolean) => void;
  setShowDetailedMoveSuggestion: (show: boolean) => void;
  setShowEvalBar: (show: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      language: 'en',
      showGameStatistics: true,
      showDetailedMoveSuggestion: true,
      showEvalBar: true,

      // Actions
      setLanguage: (language) => set({ language }),
      setShowGameStatistics: (show) => set({ showGameStatistics: show }),
      setShowDetailedMoveSuggestion: (show) => set({ showDetailedMoveSuggestion: show }),
      setShowEvalBar: (show) => set({ showEvalBar: show }),
    }),
    {
      name: 'chessr-settings',
      storage: {
        getItem: async (name) => {
          const result = await chrome.storage.local.get(name);
          return result[name] ?? null;
        },
        setItem: async (name, value) => {
          await chrome.storage.local.set({ [name]: value });
        },
        removeItem: async (name) => {
          await chrome.storage.local.remove(name);
        },
      },
    }
  )
);
