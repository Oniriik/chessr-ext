/**
 * BoardContextStore - Receives board state from pageContext.js (MAIN world)
 * via CustomEvents dispatched on window.
 */

import { create } from 'zustand';

interface BoardContextState {
  boardFen: string | null;
  isGameOver: boolean;
}

export const useBoardContextStore = create<BoardContextState>()(() => ({
  boardFen: null,
  isGameOver: false,
}));

// Listen for postMessage from pageContext.js (MAIN world)
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'chessr:boardFen') {
      useBoardContextStore.setState({ boardFen: e.data.fen });
    } else if (e.data?.type === 'chessr:gameOver') {
      useBoardContextStore.setState({ isGameOver: true });
    }
  });
}
