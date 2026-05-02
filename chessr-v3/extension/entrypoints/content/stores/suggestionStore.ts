import { create } from 'zustand';
import type { LabeledSuggestion, MoveLabel } from '../lib/engineLabeler';
import type { MoveClassification } from '../lib/moveAnalysis';

export type { MoveLabel };
export type Suggestion = LabeledSuggestion;

interface SuggestionState {
  suggestions: Suggestion[];
  loading: boolean;
  requestId: string | null;

  setSuggestions: (suggestions: Suggestion[], requestId: string) => void;
  setLoading: (loading: boolean, requestId?: string) => void;
  /** Decorate a single suggestion with its torch-derived classification.
   *  No-op if requestId doesn't match (stale) or move doesn't match an
   *  existing suggestion (suggestion list rotated under us). */
  setClassification: (requestId: string, move: string, cls: MoveClassification) => void;
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
    const prev = get().suggestions;
    const same = sameMoveSet(prev, suggestions);
    console.log('[Chessr][dbg] store.setSuggestions', {
      rid: requestId,
      same,
      prev: prev.map((s) => s.move),
      next: suggestions.map((s) => s.move),
    });
    if (same) {
      set({ loading: false, requestId });
      return;
    }
    set({ suggestions, loading: false, requestId });
  },
  setLoading: (loading, requestId) => set({ loading, ...(requestId ? { requestId } : {}) }),
  setClassification: (requestId, move, cls) => {
    const cur = get();
    if (cur.requestId !== requestId) return;
    const idx = cur.suggestions.findIndex((s) => s.move === move);
    if (idx < 0) return;
    if (cur.suggestions[idx].class === cls) return;
    const next = cur.suggestions.slice();
    next[idx] = { ...next[idx], class: cls };
    set({ suggestions: next });
  },
  clear: () => set({ suggestions: [], loading: false, requestId: null }),
}));
