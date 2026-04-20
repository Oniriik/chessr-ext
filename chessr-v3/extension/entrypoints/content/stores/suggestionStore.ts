import { create } from 'zustand';

export type MoveLabel = 'check' | 'mate' | 'capture' | 'promotion';

export interface Suggestion {
  move: string;
  evaluation: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  depth: number;
  mateScore: number | null;
  pv: string[];
  labels: MoveLabel[];
}

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
