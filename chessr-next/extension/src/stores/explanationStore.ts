/**
 * ExplanationStore - Manages LLM move explanations with caching and daily quota
 */

import { create } from 'zustand';
import {
  fetchMoveExplanation,
  fetchExplanationUsage,
  type MoveExplanationParams,
} from '../lib/explanationClient';
import { useSettingsStore } from './settingsStore';

interface ExplanationState {
  // Cache: "fen:moveUci" → explanation text
  cache: Record<string, string>;

  // Currently loading key (null if idle)
  loadingKey: string | null;

  // Transient error message
  error: string | null;

  // Daily quota tracking
  dailyUsage: number;
  dailyLimit: number;

  // Actions
  fetchExplanation: (params: MoveExplanationParams) => Promise<void>;
  fetchUsage: () => Promise<void>;
  clearExplanations: () => void;
}

function cacheKey(fen: string, moveUci: string): string {
  return `${fen}:${moveUci}`;
}

export const useExplanationStore = create<ExplanationState>()((set, get) => ({
  cache: {},
  loadingKey: null,
  error: null,
  dailyUsage: 0,
  dailyLimit: 0,

  fetchExplanation: async (params) => {
    const key = cacheKey(params.fen, params.moveUci);

    // Already cached
    if (get().cache[key]) return;

    // Already loading this one
    if (get().loadingKey === key) return;

    set({ loadingKey: key, error: null });

    try {
      const language = useSettingsStore.getState().language || 'en';
      const { explanation, dailyUsage, dailyLimit } = await fetchMoveExplanation({ ...params, language });
      set((state) => ({
        cache: { ...state.cache, [key]: explanation },
        loadingKey: null,
        dailyUsage,
        dailyLimit,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to explain move';
      set({ loadingKey: null, error: message });
      setTimeout(() => {
        if (get().error === message) {
          set({ error: null });
        }
      }, 5000);
    }
  },

  fetchUsage: async () => {
    try {
      const { dailyUsage, dailyLimit } = await fetchExplanationUsage();
      set({ dailyUsage, dailyLimit });
    } catch {
      // Silently fail — quota display is non-critical
    }
  },

  clearExplanations: () => {
    set({ cache: {}, loadingKey: null, error: null });
  },
}));

// Selectors
export const useExplanation = (fen: string, moveUci: string) =>
  useExplanationStore((state) => state.cache[cacheKey(fen, moveUci)] ?? null);

export const useIsExplanationLoading = (fen: string, moveUci: string) =>
  useExplanationStore((state) => state.loadingKey === cacheKey(fen, moveUci));

export const useExplanationError = () =>
  useExplanationStore((state) => state.error);

export const useExplanationDailyUsage = () =>
  useExplanationStore((state) => state.dailyUsage);

export const useExplanationDailyLimit = () =>
  useExplanationStore((state) => state.dailyLimit);
