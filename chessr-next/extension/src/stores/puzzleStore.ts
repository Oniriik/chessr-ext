/**
 * PuzzleStore - Manages puzzle state and hint suggestions
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logger } from '../lib/logger';

export type PuzzleSearchMode = 'nodes' | 'depth' | 'movetime';

export interface PuzzleSuggestion {
  move: string;
  evaluation?: number;
  winRate?: number;
}

interface PuzzleState {
  // Detection state
  isStarted: boolean;
  isSolved: boolean;
  playerColor: 'white' | 'black' | null;
  currentFen: string | null;

  // Settings
  autoHint: boolean;

  // Engine search settings
  searchMode: PuzzleSearchMode;
  searchNodes: number;
  searchDepth: number;
  searchMovetime: number;

  // Suggestion state (multiple suggestions for multiPV)
  suggestions: PuzzleSuggestion[];
  suggestion: PuzzleSuggestion | null; // Best move (first suggestion)
  isLoading: boolean;
  currentRequestId: string | null;

  // Actions
  setStarted: (started: boolean, color: 'white' | 'black' | null) => void;
  setSolved: (solved: boolean) => void;
  setFen: (fen: string | null) => void;
  setAutoHint: (enabled: boolean) => void;
  setSearchMode: (mode: PuzzleSearchMode) => void;
  setSearchNodes: (value: number) => void;
  setSearchDepth: (value: number) => void;
  setSearchMovetime: (value: number) => void;
  requestSuggestion: () => string;
  receiveSuggestions: (requestId: string, suggestions: PuzzleSuggestion[]) => void;
  clearSuggestion: () => void;
  reset: () => void;
}

function generateRequestId(): string {
  return `puzzle-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const usePuzzleStore = create<PuzzleState>()(
  persist(
  (set, get) => ({
  // Initial state
  isStarted: false,
  isSolved: false,
  playerColor: null,
  currentFen: null,
  autoHint: true, // Auto hint enabled by default
  searchMode: 'nodes' as PuzzleSearchMode,
  searchNodes: 1_000_000,
  searchDepth: 20,
  searchMovetime: 2000,
  suggestions: [],
  suggestion: null,
  isLoading: false,
  currentRequestId: null,

  setStarted: (started, color) => {
    logger.log(`[puzzle] setStarted: ${started}, color: ${color}`);
    set({
      isStarted: started,
      isSolved: false,
      playerColor: color,
      // Clear suggestions when puzzle state changes
      suggestions: [],
      suggestion: null,
      isLoading: false,
      currentRequestId: null,
    });
  },

  setSolved: (solved) => {
    logger.log(`[puzzle] setSolved: ${solved}`);
    set({
      isSolved: solved,
      // Clear suggestions when solved
      suggestions: [],
      suggestion: null,
      isLoading: false,
    });
  },

  setFen: (fen) => {
    const prev = get().currentFen;
    if (fen !== prev) {
      logger.log(`[puzzle] FEN changed: ${fen?.split(' ')[0]}`);
      set({
        currentFen: fen,
        // Clear previous suggestions when position changes
        suggestions: [],
        suggestion: null,
      });
    }
  },

  setAutoHint: (enabled) => {
    logger.log(`[puzzle] autoHint: ${enabled}`);
    set({ autoHint: enabled });
  },

  setSearchMode: (mode) => set({ searchMode: mode }),
  setSearchNodes: (value) => set({ searchNodes: Math.max(100_000, Math.min(5_000_000, value)) }),
  setSearchDepth: (value) => set({ searchDepth: Math.max(1, Math.min(30, value)) }),
  setSearchMovetime: (value) => set({ searchMovetime: Math.max(500, Math.min(5000, value)) }),

  requestSuggestion: () => {
    const requestId = generateRequestId();
    logger.log(`[puzzle] Requesting suggestion, id=${requestId}`);
    set({
      currentRequestId: requestId,
      isLoading: true,
    });
    return requestId;
  },

  receiveSuggestions: (requestId, suggestions) => {
    const { currentRequestId } = get();

    if (requestId !== currentRequestId) {
      logger.log(`[puzzle] Ignoring stale suggestions: ${requestId} (expected ${currentRequestId})`);
      return;
    }

    logger.log(`[puzzle] Received ${suggestions.length} suggestions: ${suggestions.map(s => s.move).join(', ')}`);
    set({
      suggestions,
      suggestion: suggestions.length > 0 ? suggestions[0] : null,
      isLoading: false,
    });
  },

  clearSuggestion: () => {
    set({
      suggestions: [],
      suggestion: null,
      isLoading: false,
      currentRequestId: null,
    });
  },

  reset: () => {
    set({
      isStarted: false,
      isSolved: false,
      playerColor: null,
      currentFen: null,
      suggestions: [],
      suggestion: null,
      isLoading: false,
      currentRequestId: null,
    });
  },
}),
    {
      name: 'chessr-puzzle-settings',
      partialize: (state) => ({
        autoHint: state.autoHint,
        searchMode: state.searchMode,
        searchNodes: state.searchNodes,
        searchDepth: state.searchDepth,
        searchMovetime: state.searchMovetime,
      }),
    }
  )
);

// Convenience selectors
export const usePuzzleIsStarted = () => usePuzzleStore((state) => state.isStarted);
export const usePuzzlePlayerColor = () => usePuzzleStore((state) => state.playerColor);
export const usePuzzleFen = () => usePuzzleStore((state) => state.currentFen);
export const usePuzzleAutoHint = () => usePuzzleStore((state) => state.autoHint);
export const usePuzzleSuggestions = () => usePuzzleStore((state) => state.suggestions);
export const usePuzzleSuggestion = () => usePuzzleStore((state) => state.suggestion);
export const usePuzzleIsLoading = () => usePuzzleStore((state) => state.isLoading);
