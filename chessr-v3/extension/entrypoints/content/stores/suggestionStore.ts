import { create } from 'zustand';
import type { LabeledSuggestion, MoveLabel } from '../lib/engineLabeler';

export type { MoveLabel };
export type Suggestion = LabeledSuggestion;

interface SuggestionState {
  suggestions: Suggestion[];
  loading: boolean;
  requestId: string | null;

  setSuggestions: (suggestions: Suggestion[], requestId: string) => void;
  setLoading: (loading: boolean, requestId?: string) => void;
  clear: () => void;
}

export const useSuggestionStore = create<SuggestionState>((set) => ({
  suggestions: [],
  loading: false,
  requestId: null,

  setSuggestions: (suggestions, requestId) => set({ suggestions, loading: false, requestId }),
  setLoading: (loading, requestId) => set({ loading, ...(requestId ? { requestId } : {}) }),
  clear: () => set({ suggestions: [], loading: false, requestId: null }),
}));
