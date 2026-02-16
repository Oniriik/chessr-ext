/**
 * Settings Store (Zustand)
 * Manages user preferences and settings
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EvalBarMode = 'eval' | 'winrate';

interface SettingsState {
  // Language
  language: string;

  // Display settings
  showGameStatistics: boolean;
  showDetailedMoveSuggestion: boolean;
  showEvalBar: boolean;
  evalBarMode: EvalBarMode;

  // Suggestions settings
  numberOfSuggestions: 1 | 2 | 3;
  useSameColorForAllArrows: boolean;
  singleArrowColor: string;
  firstArrowColor: string;
  secondArrowColor: string;
  thirdArrowColor: string;

  // Actions
  setLanguage: (language: string) => void;
  setShowGameStatistics: (show: boolean) => void;
  setShowDetailedMoveSuggestion: (show: boolean) => void;
  setShowEvalBar: (show: boolean) => void;
  setEvalBarMode: (mode: EvalBarMode) => void;
  setNumberOfSuggestions: (num: 1 | 2 | 3) => void;
  setUseSameColorForAllArrows: (use: boolean) => void;
  setSingleArrowColor: (color: string) => void;
  setFirstArrowColor: (color: string) => void;
  setSecondArrowColor: (color: string) => void;
  setThirdArrowColor: (color: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      language: 'en',
      showGameStatistics: true,
      showDetailedMoveSuggestion: true,
      showEvalBar: true,
      evalBarMode: 'eval',

      // Suggestions defaults
      numberOfSuggestions: 3,
      useSameColorForAllArrows: false,
      singleArrowColor: '#22c55e',
      firstArrowColor: '#22c55e',
      secondArrowColor: '#3b82f6',
      thirdArrowColor: '#f59e0b',

      // Actions
      setLanguage: (language) => set({ language }),
      setShowGameStatistics: (show) => set({ showGameStatistics: show }),
      setShowDetailedMoveSuggestion: (show) => set({ showDetailedMoveSuggestion: show }),
      setShowEvalBar: (show) => set({ showEvalBar: show }),
      setEvalBarMode: (mode) => set({ evalBarMode: mode }),
      setNumberOfSuggestions: (num) => set({ numberOfSuggestions: num }),
      setUseSameColorForAllArrows: (use) => set({ useSameColorForAllArrows: use }),
      setSingleArrowColor: (color) => set({ singleArrowColor: color }),
      setFirstArrowColor: (color) => set({ firstArrowColor: color }),
      setSecondArrowColor: (color) => set({ secondArrowColor: color }),
      setThirdArrowColor: (color) => set({ thirdArrowColor: color }),
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
