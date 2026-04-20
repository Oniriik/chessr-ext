/**
 * ExplanationStore — LLM move explanations with cache and daily quota
 */

import { create } from 'zustand';
import { fetchMoveExplanation, type MoveExplanationParams } from '../lib/explanationClient';

function cacheKey(fen: string, moveUci: string): string {
  return `${fen}:${moveUci}`;
}

interface ExplanationState {
  cache: Record<string, string>;
  loadingKey: string | null;
  error: string | null;
  dailyUsage: number;
  dailyLimit: number;

  fetchExplanation: (params: MoveExplanationParams) => Promise<void>;
  clear: () => void;
}

export const useExplanationStore = create<ExplanationState>()((set, get) => ({
  cache: {},
  loadingKey: null,
  error: null,
  dailyUsage: 0,
  dailyLimit: 50,

  fetchExplanation: async (params) => {
    const key = cacheKey(params.fen, params.moveUci);
    if (get().cache[key] || get().loadingKey === key) return;

    set({ loadingKey: key, error: null });

    try {
      const { explanation, dailyUsage, dailyLimit } = await fetchMoveExplanation(params);
      set((s) => ({
        cache: { ...s.cache, [key]: explanation },
        loadingKey: null,
        dailyUsage,
        dailyLimit,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      set({ loadingKey: null, error: msg });
      setTimeout(() => {
        if (get().error === msg) set({ error: null });
      }, 5000);
    }
  },

  clear: () => set({ cache: {}, loadingKey: null, error: null }),
}));

export const useExplanation = (fen: string, moveUci: string) =>
  useExplanationStore((s) => s.cache[cacheKey(fen, moveUci)] ?? null);

export const useIsExplanationLoading = (fen: string, moveUci: string) =>
  useExplanationStore((s) => s.loadingKey === cacheKey(fen, moveUci));
