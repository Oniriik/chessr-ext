import { create } from 'zustand';

interface GameState {
  // State
  isGameStarted: boolean;
  playerColor: 'white' | 'black' | null;
  currentTurn: 'white' | 'black';

  // Actions
  setGameStarted: (started: boolean) => void;
  setPlayerColor: (color: 'white' | 'black' | null) => void;
  setCurrentTurn: (turn: 'white' | 'black') => void;
  reset: () => void;
}

export const useGameStore = create<GameState>()((set) => ({
  isGameStarted: false,
  playerColor: null,
  currentTurn: 'white',

  setGameStarted: (started) => set({ isGameStarted: started }),
  setPlayerColor: (color) => set({ playerColor: color }),
  setCurrentTurn: (turn) => set({ currentTurn: turn }),
  reset: () => set({ isGameStarted: false, playerColor: null, currentTurn: 'white' }),
}));
