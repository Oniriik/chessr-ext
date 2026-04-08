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

  // Title simulator
  showTitle: boolean;
  titleType: string;

  // Privacy
  anonNames: boolean;
  anonUrl: boolean;

  // Suggestions settings
  numberOfSuggestions: 1 | 2 | 3;
  useSameColorForAllArrows: boolean;
  singleArrowColor: string;
  firstArrowColor: string;
  secondArrowColor: string;
  thirdArrowColor: string;

  // Hotkey move
  hotkeyMoveEnabled: boolean;
  firstHotkey: string;
  secondHotkey: string;
  thirdHotkey: string;
  premoveHotkey: string;
  premoveDelayRange: [number, number];
  humanizeEnabled: boolean;
  pickDelayRange: [number, number];
  selectDelayRange: [number, number];
  moveDelayRange: [number, number];

  // Actions
  setLanguage: (language: string) => void;
  setShowGameStatistics: (show: boolean) => void;
  setShowDetailedMoveSuggestion: (show: boolean) => void;
  setShowEvalBar: (show: boolean) => void;
  setEvalBarMode: (mode: EvalBarMode) => void;
  setShowTitle: (show: boolean) => void;
  setTitleType: (type: string) => void;
  setAnonNames: (value: boolean) => void;
  setAnonUrl: (value: boolean) => void;
  setNumberOfSuggestions: (num: 1 | 2 | 3) => void;
  setUseSameColorForAllArrows: (use: boolean) => void;
  setSingleArrowColor: (color: string) => void;
  setFirstArrowColor: (color: string) => void;
  setSecondArrowColor: (color: string) => void;
  setThirdArrowColor: (color: string) => void;
  setHotkeyMoveEnabled: (enabled: boolean) => void;
  setFirstHotkey: (key: string) => void;
  setSecondHotkey: (key: string) => void;
  setThirdHotkey: (key: string) => void;
  setPremoveHotkey: (key: string) => void;
  setPremoveDelayRange: (range: [number, number]) => void;
  setHumanizeEnabled: (enabled: boolean) => void;
  setPickDelayRange: (range: [number, number]) => void;
  setSelectDelayRange: (range: [number, number]) => void;
  setMoveDelayRange: (range: [number, number]) => void;
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

      // Title simulator
      showTitle: false,
      titleType: 'GM',

      // Privacy
      anonNames: false,
      anonUrl: false,

      // Suggestions defaults
      numberOfSuggestions: 3,
      useSameColorForAllArrows: false,
      singleArrowColor: '#22c55e',
      firstArrowColor: '#22c55e',
      secondArrowColor: '#3b82f6',
      thirdArrowColor: '#f59e0b',

      // Hotkey move defaults
      hotkeyMoveEnabled: false,
      firstHotkey: '1',
      secondHotkey: '2',
      thirdHotkey: '3',
      premoveHotkey: 'Shift',
      premoveDelayRange: [300, 800] as [number, number],
      humanizeEnabled: true,
      pickDelayRange: [50, 150] as [number, number],
      selectDelayRange: [30, 100] as [number, number],
      moveDelayRange: [100, 300] as [number, number],

      // Actions
      setLanguage: (language) => set({ language }),
      setShowGameStatistics: (show) => set({ showGameStatistics: show }),
      setShowDetailedMoveSuggestion: (show) => set({ showDetailedMoveSuggestion: show }),
      setShowEvalBar: (show) => set({ showEvalBar: show }),
      setEvalBarMode: (mode) => set({ evalBarMode: mode }),
      setShowTitle: (show) => set({ showTitle: show }),
      setTitleType: (type) => set({ titleType: type }),
      setAnonNames: (value) => set({ anonNames: value }),
      setAnonUrl: (value) => set({ anonUrl: value }),
      setNumberOfSuggestions: (num) => set({ numberOfSuggestions: num }),
      setUseSameColorForAllArrows: (use) => set({ useSameColorForAllArrows: use }),
      setSingleArrowColor: (color) => set({ singleArrowColor: color }),
      setFirstArrowColor: (color) => set({ firstArrowColor: color }),
      setSecondArrowColor: (color) => set({ secondArrowColor: color }),
      setThirdArrowColor: (color) => set({ thirdArrowColor: color }),
      setHotkeyMoveEnabled: (enabled) => set({ hotkeyMoveEnabled: enabled }),
      setFirstHotkey: (key) => set({ firstHotkey: key }),
      setSecondHotkey: (key) => set({ secondHotkey: key }),
      setThirdHotkey: (key) => set({ thirdHotkey: key }),
      setPremoveHotkey: (key) => set({ premoveHotkey: key }),
      setPremoveDelayRange: (range) => set({ premoveDelayRange: range }),
      setHumanizeEnabled: (enabled) => set({ humanizeEnabled: enabled }),
      setPickDelayRange: (range) => set({ pickDelayRange: range }),
      setSelectDelayRange: (range) => set({ selectDelayRange: range }),
      setMoveDelayRange: (range) => set({ moveDelayRange: range }),
    }),
    {
      name: 'chessr-settings',
      storage: {
        getItem: async (name) => {
          const result = await chrome.storage.local.get(name);
          const data = result[name] ?? null;
          // Migrate old anonymousMode to new anonNames + anonUrl
          if (data?.state?.anonymousMode !== undefined && data?.state?.anonNames === undefined) {
            data.state.anonNames = data.state.anonymousMode;
            data.state.anonUrl = data.state.anonymousMode;
            delete data.state.anonymousMode;
          }
          return data;
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
