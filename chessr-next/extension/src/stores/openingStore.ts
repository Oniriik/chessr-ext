/**
 * Opening Store (Zustand)
 * Manages opening book state and user's opening repertoire
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BookMove, OpeningInfo } from '../lib/openingBook';

// Saved opening with full details
export interface SavedOpening {
  name: string;
  moves: string; // SAN format: "1. e4 e5 2. Nf3 Nc6"
  eco: string;
  totalGames: number;
}

// Repertoire - user's preferred openings
export interface OpeningRepertoire {
  white: SavedOpening | null;
  black: SavedOpening | null;
}

// Current game opening state
interface OpeningState {
  // Current position info
  isInBook: boolean;
  openingName: string | null;
  eco: string | null;
  bookMoves: BookMove[];
  totalGames: number;
  statsUnavailable: boolean; // true when Lichess API failed

  // Tracking
  leftBookAtMove: number | null;
  previousOpeningName: string | null;
  deviationDetected: boolean;
  deviationMove: string | null;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // User repertoire (persisted)
  repertoire: OpeningRepertoire;

  // Settings
  showOpeningArrows: boolean;
  showOpeningCard: boolean;
  openingArrowColor: string;

  // Actions - Opening state
  setOpeningData: (data: {
    opening: OpeningInfo | null;
    moves: BookMove[];
    isInBook: boolean;
    totalGames: number;
    statsUnavailable?: boolean;
  }) => void;
  markOutOfBook: (moveNumber: number) => void;
  setDeviation: (move: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  // Actions - Repertoire
  setWhiteOpening: (opening: SavedOpening | null) => void;
  setBlackOpening: (opening: SavedOpening | null) => void;
  clearRepertoire: () => void;

  // Actions - Settings
  setShowOpeningArrows: (show: boolean) => void;
  setShowOpeningCard: (show: boolean) => void;
  setOpeningArrowColor: (color: string) => void;
}

const initialRepertoire: OpeningRepertoire = {
  white: null,
  black: null,
};

export const useOpeningStore = create<OpeningState>()(
  persist(
    (set, get) => ({
      // Initial state
      isInBook: false,
      openingName: null,
      eco: null,
      bookMoves: [],
      totalGames: 0,
      statsUnavailable: false,
      leftBookAtMove: null,
      previousOpeningName: null,
      deviationDetected: false,
      deviationMove: null,
      isLoading: false,
      error: null,

      // Persisted state
      repertoire: initialRepertoire,
      showOpeningArrows: true,
      showOpeningCard: true,
      openingArrowColor: '#a855f7', // Purple

      // Opening state actions
      setOpeningData: (data) => {
        const { openingName: previousName } = get();

        set({
          isInBook: data.isInBook,
          openingName: data.opening?.name ?? null,
          eco: data.opening?.eco ?? null,
          bookMoves: data.moves,
          totalGames: data.totalGames,
          statsUnavailable: data.statsUnavailable ?? false,
          previousOpeningName: previousName,
          isLoading: false,
          error: null,
        });
      },

      markOutOfBook: (moveNumber) => {
        set({
          isInBook: false,
          leftBookAtMove: moveNumber,
          bookMoves: [],
        });
      },

      setDeviation: (move) => {
        set({
          deviationDetected: move !== null,
          deviationMove: move,
        });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      setError: (error) => set({ error, isLoading: false }),

      reset: () => {
        set({
          isInBook: false,
          openingName: null,
          eco: null,
          bookMoves: [],
          totalGames: 0,
          statsUnavailable: false,
          leftBookAtMove: null,
          previousOpeningName: null,
          deviationDetected: false,
          deviationMove: null,
          isLoading: false,
          error: null,
        });
      },

      // Repertoire actions
      setWhiteOpening: (opening) => {
        set((state) => ({
          repertoire: { ...state.repertoire, white: opening },
        }));
      },

      setBlackOpening: (opening) => {
        set((state) => ({
          repertoire: { ...state.repertoire, black: opening },
        }));
      },

      clearRepertoire: () => {
        set({ repertoire: initialRepertoire });
      },

      // Settings actions
      setShowOpeningArrows: (show) => set({ showOpeningArrows: show }),
      setShowOpeningCard: (show) => set({ showOpeningCard: show }),
      setOpeningArrowColor: (color) => set({ openingArrowColor: color }),
    }),
    {
      name: 'chessr-opening',
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
      // Only persist these fields
      partialize: (state) =>
        ({
          repertoire: state.repertoire,
          showOpeningArrows: state.showOpeningArrows,
          showOpeningCard: state.showOpeningCard,
          openingArrowColor: state.openingArrowColor,
        }) as OpeningState,
    }
  )
);

// Convenience selectors
export const useIsInBook = () => useOpeningStore((state) => state.isInBook);
export const useOpeningName = () => useOpeningStore((state) => state.openingName);
export const useBookMoves = () => useOpeningStore((state) => state.bookMoves);
export const useRepertoire = () => useOpeningStore((state) => state.repertoire);
export const useShowOpeningArrows = () =>
  useOpeningStore((state) => state.showOpeningArrows);
