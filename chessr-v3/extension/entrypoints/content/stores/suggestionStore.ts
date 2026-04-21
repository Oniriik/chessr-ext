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

function sameMoveSet(a: Suggestion[], b: Suggestion[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].move !== b[i].move) return false;
  }
  return true;
}

export const useSuggestionStore = create<SuggestionState>((set, get) => ({
  suggestions: [],
  loading: false,
  requestId: null,

  setSuggestions: (suggestions, requestId) => {
    // Skip the store update (and the arrow-rendering subscriber that fires off
    // it) when the incoming suggestions list is identical to the current one
    // in both order and move set. Prevents the same arrows from being
    // re-animated every time the engine re-evaluates an unchanged position.
    const prev = get().suggestions;
    if (sameMoveSet(prev, suggestions)) {
      // Still need to clear the loading flag and record the latest requestId.
      set({ loading: false, requestId });
      return;
    }
    set({ suggestions, loading: false, requestId });
  },
  setLoading: (loading, requestId) => set({ loading, ...(requestId ? { requestId } : {}) }),
  clear: () => set({ suggestions: [], loading: false, requestId: null }),
}));
