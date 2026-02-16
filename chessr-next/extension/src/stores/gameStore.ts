import { create } from 'zustand';
import { Chess } from 'chess.js';
import { extractMovesFromDOM, replayMoves, getChessState, type ChessState } from '../lib/chess';

interface GameState {
  // Core state
  isGameStarted: boolean;
  playerColor: 'white' | 'black' | null;
  currentTurn: 'white' | 'black';

  // Chess.js state
  chessInstance: Chess | null;
  moveHistory: string[]; // SAN moves

  // Actions
  setGameStarted: (started: boolean) => void;
  setPlayerColor: (color: 'white' | 'black' | null) => void;
  setCurrentTurn: (turn: 'white' | 'black') => void;

  // Chess actions
  syncFromDOM: () => void;
  reset: () => void;

  // Selectors (computed from chessInstance)
  getChessState: () => ChessState | null;
}

export const useGameStore = create<GameState>()((set, get) => ({
  // Initial state
  isGameStarted: false,
  playerColor: null,
  currentTurn: 'white',
  chessInstance: null,
  moveHistory: [],

  // Basic setters
  setGameStarted: (started) => set({ isGameStarted: started }),
  setPlayerColor: (color) => set({ playerColor: color }),
  setCurrentTurn: (turn) => set({ currentTurn: turn }),

  /**
   * Sync chess.js state from DOM move list
   * Called by useGameDetection when moves change
   */
  syncFromDOM: () => {
    const moves = extractMovesFromDOM();
    const { moveHistory } = get();

    // Only update if moves changed
    if (
      moves.length === moveHistory.length &&
      moves.every((m, i) => m === moveHistory[i])
    ) {
      return;
    }

    const chessInstance = replayMoves(moves);
    if (chessInstance) {
      const turn = chessInstance.turn() === 'w' ? 'white' : 'black';

      console.log('[chess] Moves:', moves);
      console.log('[chess] FEN:', chessInstance.fen());

      set({
        chessInstance,
        moveHistory: moves,
        currentTurn: turn,
      });
    }
  },

  /**
   * Reset all game state (new game)
   */
  reset: () =>
    set({
      isGameStarted: false,
      playerColor: null,
      currentTurn: 'white',
      chessInstance: null,
      moveHistory: [],
    }),

  /**
   * Get computed chess state
   */
  getChessState: () => {
    const { chessInstance } = get();
    return getChessState(chessInstance);
  },
}));

// Convenience selectors for common derived state
export const useChessState = () => useGameStore((state) => state.getChessState());
export const useFEN = () => useGameStore((state) => state.chessInstance?.fen() ?? null);
export const useIsCheck = () => useGameStore((state) => state.chessInstance?.isCheck() ?? false);
export const useLegalMoves = () =>
  useGameStore((state) => state.chessInstance?.moves({ verbose: true }) ?? []);
