/**
 * useEvalBar - Manages the evaluation bar overlay
 * Shows position evaluation as a vertical bar next to the board
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { EvalBar } from '../content/overlay/EvalBar';

/**
 * Find the chess board element on Chess.com
 */
function findBoardElement(): HTMLElement | null {
  return document.querySelector('wc-chess-board, chess-board, .chessboard') as HTMLElement | null;
}

export function useEvalBar() {
  const { isGameStarted, playerColor } = useGameStore();
  const { positionEval, mateIn, winRate, suggestedFen } = useSuggestionStore();
  const { showEvalBar, evalBarMode } = useSettingsStore();

  const evalBarRef = useRef<EvalBar | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize eval bar when game starts or player color changes
  useEffect(() => {
    // Clean up when game ends or eval bar is disabled
    if (!isGameStarted || !showEvalBar) {
      if (evalBarRef.current) {
        evalBarRef.current.destroy();
        evalBarRef.current = null;
        isInitializedRef.current = false;
      }
      return;
    }

    // Find board element
    const boardElement = findBoardElement();
    if (!boardElement) return;

    // Initialize eval bar if not already done
    if (!isInitializedRef.current) {
      const evalBar = new EvalBar();
      evalBar.initialize(boardElement);
      evalBar.setFlipped(playerColor === 'black'); // Set initial flip state
      evalBarRef.current = evalBar;
      isInitializedRef.current = true;
    } else if (evalBarRef.current) {
      // Update flip state if already initialized
      evalBarRef.current.setFlipped(playerColor === 'black');
    }

    return () => {
      // Cleanup on unmount
      if (evalBarRef.current) {
        evalBarRef.current.destroy();
        evalBarRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, [isGameStarted, playerColor, showEvalBar]);

  // Update eval bar when position eval changes (pass raw values, bar handles flipping)
  useEffect(() => {
    const evalBar = evalBarRef.current;
    if (!evalBar) return;

    if (positionEval !== null && suggestedFen) {
      // Pass raw eval values - bar handles flipping internally
      evalBar.update(positionEval, mateIn, evalBarMode, winRate ?? 50);
      evalBar.show();
    } else {
      // No eval available, hide the bar
      evalBar.hide();
    }
  }, [positionEval, mateIn, winRate, suggestedFen, evalBarMode]);
}
