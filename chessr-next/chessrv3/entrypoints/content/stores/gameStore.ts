import { create } from 'zustand';

export type Color = 'white' | 'black' | null;

export interface GameEndInfo {
  checkmate: boolean;
  stalemate: boolean;
  draw: boolean;
  threefold: boolean;
  insufficient: boolean;
  fiftyMoveRule: boolean;
}

// PGN result string: "1-0", "0-1", "1/2-1/2", "*" (in progress)
type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';

interface GameState {
  isPlaying: boolean;
  fen: string | null;
  gameOver: boolean;
  gameEnd: GameEndInfo | null;
  result: GameResult;
  playerColor: Color;
  turn: Color;

  setPlaying: (playing: boolean) => void;
  setMove: (fen: string, gameOver: boolean, turn: Color, gameEnd?: GameEndInfo | null) => void;
  setGameOver: (result: GameResult) => void;
  setPlayerColor: (color: Color) => void;
  reset: () => void;
}

function toColor(value: number | null): Color {
  if (value === 1) return 'white';
  if (value === 2) return 'black';
  return null;
}

export { toColor };

export const useGameStore = create<GameState>((set) => ({
  isPlaying: false,
  fen: null,
  gameOver: false,
  gameEnd: null,
  result: '*',
  playerColor: null,
  turn: null,

  setPlaying: (playing) => set({ isPlaying: playing }),
  setMove: (fen, gameOver, turn, gameEnd = null) => set({ fen, gameOver, turn, gameEnd }),
  setGameOver: (result) => set({ gameOver: true, result }),
  setPlayerColor: (color) => set({ playerColor: color }),
  reset: () => set({ isPlaying: false, fen: null, gameOver: false, gameEnd: null, result: '*', playerColor: null, turn: null }),
}));
