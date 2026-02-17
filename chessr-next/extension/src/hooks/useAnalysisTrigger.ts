/**
 * useAnalysisTrigger - Triggers move analysis after player makes a move
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useAccuracyStore } from '../stores/accuracyStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { logger } from '../lib/logger';

/**
 * Hook that triggers analysis when:
 * 1. It becomes opponent's turn (player just moved)
 * 2. WebSocket is connected
 * 3. Move not already analyzed
 *
 * Key insight: We analyze AFTER player moves, so we watch for turn change
 * FROM player's turn TO opponent's turn
 */
export function useAnalysisTrigger() {
  const { isGameStarted, playerColor, currentTurn, chessInstance, moveHistory } =
    useGameStore();
  const { requestAnalysis, reset: resetAccuracy } = useAccuracyStore();
  const { isConnected, send } = useWebSocketStore();

  const lastAnalyzedMoveCount = useRef<number>(0);
  const previousFenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isGameStarted || !isConnected || !chessInstance || !playerColor) {
      return;
    }

    // Only analyze when it becomes opponent's turn (meaning player just moved)
    const isOpponentTurn = playerColor !== currentTurn;

    if (!isOpponentTurn) {
      // Store the FEN before player's move
      previousFenRef.current = chessInstance.fen();
      return;
    }

    // Check if this is a new move (not already analyzed)
    const currentMoveCount = moveHistory.length;
    if (currentMoveCount <= lastAnalyzedMoveCount.current) {
      return;
    }

    // Get the move that was just made
    const history = chessInstance.history({ verbose: true });
    const lastMove = history[history.length - 1];

    if (!lastMove || !previousFenRef.current) {
      return;
    }

    // Only analyze player's moves, not opponent's
    const moveColor = lastMove.color === 'w' ? 'white' : 'black';
    if (moveColor !== playerColor) {
      return;
    }

    const fenBefore = previousFenRef.current;
    const fenAfter = chessInstance.fen();
    const move = lastMove.from + lastMove.to + (lastMove.promotion || '');
    const moveNumber = Math.ceil(currentMoveCount / 2);

    logger.log(`Triggering analysis for player's move: ${move} (move ${moveNumber})`);

    // Mark as analyzed
    lastAnalyzedMoveCount.current = currentMoveCount;

    // Create request
    const requestId = requestAnalysis(moveNumber);

    // Send WebSocket message
    send({
      type: 'analyze',
      requestId,
      fenBefore,
      fenAfter,
      move,
      playerColor,
    });
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

  // Reset on new game
  useEffect(() => {
    if (!isGameStarted) {
      lastAnalyzedMoveCount.current = 0;
      previousFenRef.current = null;
      resetAccuracy();
    }
  }, [isGameStarted, resetAccuracy]);
}
