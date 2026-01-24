/**
 * Opening Store (Zustand)
 */

import { create } from 'zustand';
import { Opening, OpeningCategory, WHITE_OPENINGS, BLACK_VS_E4, BLACK_VS_D4 } from '../../content/openings/openings-database';
import { OpeningState } from '../../content/openings/opening-tracker';

interface OpeningCallbacks {
  onSelectOpening: (opening: Opening) => void;
  onClearOpening: () => void;
  onSelectCounter: (counter: Opening) => void;
  onDeclineCounter: () => void;
}

interface OpeningStoreState {
  // Current opening state from tracker
  openingState: OpeningState;
  setOpeningState: (state: OpeningState) => void;

  // Player color
  playerColor: 'white' | 'black';
  setPlayerColor: (color: 'white' | 'black') => void;

  // UI state
  showOpeningSelector: boolean;
  setShowOpeningSelector: (show: boolean) => void;

  // Callbacks from ChessHelper
  callbacks: OpeningCallbacks | null;
  setCallbacks: (callbacks: OpeningCallbacks) => void;

  // Get available openings based on color and position
  getWhiteOpenings: () => OpeningCategory[];
  getBlackOpenings: (firstMove: string | null) => Opening[];
}

export const useOpeningStore = create<OpeningStoreState>((set) => ({
  openingState: {
    selectedOpening: null,
    detectedOpening: null,
    suggestedMove: null,
    counterOpenings: null,
    moveHistory: [],
    awaitingCounterChoice: false,
    lastDetectedOpening: null,
  },
  setOpeningState: (openingState) => set({ openingState }),

  playerColor: 'white',
  setPlayerColor: (playerColor) => set({ playerColor }),

  showOpeningSelector: false,
  setShowOpeningSelector: (showOpeningSelector) => set({ showOpeningSelector }),

  callbacks: null,
  setCallbacks: (callbacks) => set({ callbacks }),

  getWhiteOpenings: () => WHITE_OPENINGS,

  getBlackOpenings: (firstMove) => {
    if (!firstMove) return [];
    if (firstMove === 'e2e4') return BLACK_VS_E4;
    if (firstMove === 'd2d4') return BLACK_VS_D4;
    return [];
  },
}));
