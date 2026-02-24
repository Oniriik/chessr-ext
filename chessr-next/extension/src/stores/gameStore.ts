import { create } from 'zustand';
import { Chess } from 'chess.js';
import { extractMovesFromDOM, replayMoves, getChessState, type ChessState } from '../lib/chess';
import * as chesscom from '../platforms/chesscom';
import * as lichess from '../lib/lichess';

/**
 * Detect current platform from hostname
 */
function detectPlatform(): 'chesscom' | 'lichess' {
  const hostname = window.location.hostname;
  if (hostname.includes('lichess.org')) return 'lichess';
  return 'chesscom';
}

/**
 * Get platform-specific detection functions
 */
function getPlatformModule() {
  return detectPlatform() === 'lichess' ? lichess : chesscom;
}

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
  redetect: () => void;

  // Selectors (computed from chessInstance)
  getChessState: () => ChessState | null;
  getUciMoves: () => string[]; // UCI format moves (e2e4, g1f3, etc.)
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
    const { moveHistory, chessInstance: existingInstance } = get();

    // Only update if moves changed OR chessInstance not yet created
    const movesUnchanged =
      moves.length === moveHistory.length &&
      moves.every((m, i) => m === moveHistory[i]);

    if (movesUnchanged && existingInstance) {
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
   * Re-detect player color and current turn from DOM
   * Platform-aware: works on both Chess.com and Lichess
   */
  redetect: () => {
    const platformModule = getPlatformModule();
    const playerColor = platformModule.detectPlayerColor();
    const currentTurn = platformModule.detectCurrentTurn();
    set({ playerColor, currentTurn });
  },

  /**
   * Get computed chess state
   */
  getChessState: () => {
    const { chessInstance } = get();
    return getChessState(chessInstance);
  },

  /**
   * Get moves in UCI format (e2e4, g1f3, e7e8q, etc.)
   */
  getUciMoves: () => {
    const { chessInstance } = get();
    if (!chessInstance) return [];

    const history = chessInstance.history({ verbose: true });
    return history.map((move) => {
      // UCI format: from + to + promotion (if any)
      let uci = move.from + move.to;
      if (move.promotion) {
        uci += move.promotion;
      }
      return uci;
    });
  },
}));

// Convenience selectors for common derived state
export const useChessState = () => useGameStore((state) => state.getChessState());
export const useFEN = () => useGameStore((state) => state.chessInstance?.fen() ?? null);
export const useIsCheck = () => useGameStore((state) => state.chessInstance?.isCheck() ?? false);
export const useLegalMoves = () =>
  useGameStore((state) => state.chessInstance?.moves({ verbose: true }) ?? []);
