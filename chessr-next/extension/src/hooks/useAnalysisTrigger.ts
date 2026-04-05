/**
 * useAnalysisTrigger - Triggers move analysis after player makes a move
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useAccuracyStore } from '../stores/accuracyStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { logger } from '../lib/logger';
import { useBoardContextStore } from '../stores/boardContextStore';

/**
 * Watches moveHistory for new player moves and sends them for analysis.
 * Uses moveHistory length changes to detect new moves, then inspects
 * the chess.js history to find the player's move and reconstruct FENs.
 */
export function useAnalysisTrigger() {
  const { isGameStarted, playerColor, currentTurn, chessInstance, moveHistory } =
    useGameStore();
  const { requestAnalysis, reset: resetAccuracy } = useAccuracyStore();
  const { isConnected, send } = useWebSocketStore();

  const lastAnalyzedMoveIndex = useRef<number>(0);
  const wasGameStarted = useRef<boolean>(false);

  useEffect(() => {
    if (!isGameStarted || !isConnected || !chessInstance || !playerColor) {
      return;
    }

    const history = chessInstance.history({ verbose: true });
    if (history.length === 0) return;

    // Find all unanalyzed player moves
    for (let i = lastAnalyzedMoveIndex.current; i < history.length; i++) {
      const move = history[i];
      const moveColor = move.color === 'w' ? 'white' : 'black';

      if (moveColor !== playerColor) continue;

      const fenBefore = move.before;
      const fenAfter = move.after;
      const moveUci = move.from + move.to + (move.promotion || '');
      const moveNumber = Math.ceil((i + 1) / 2);

      logger.log(`Analyzing player move: ${moveUci} (move ${moveNumber}, index ${i})`);

      lastAnalyzedMoveIndex.current = i + 1;

      const requestId = requestAnalysis(moveNumber);
      send({
        type: 'analyze',
        requestId,
        fenBefore,
        fenAfter,
        move: moveUci,
        playerColor,
      });
    }
  }, [
    isGameStarted,
    playerColor,
    currentTurn,
    chessInstance,
    moveHistory,
    isConnected,
    requestAnalysis,
    send,
  ]);

  // Reset when a genuinely new game starts (not a re-detect of the same game)
  useEffect(() => {
    if (isGameStarted && !wasGameStarted.current) {
      const existingAnalyses = useAccuracyStore.getState().moveAnalyses.length;
      const currentMoves = chessInstance?.history().length || 0;
      const isGameOver = useBoardContextStore.getState().isGameOver;
      const isRedetect = existingAnalyses > 0 && (currentMoves > 2 || isGameOver);

      if (!isRedetect) {
        lastAnalyzedMoveIndex.current = 0;
        resetAccuracy();
      }
      useBoardContextStore.setState({ isGameOver: false });
    }
    wasGameStarted.current = isGameStarted;
  }, [isGameStarted, chessInstance, resetAccuracy]);
}
