/**
 * usePuzzleSuggestionTrigger - Trigger suggestions for puzzles
 * Uses max engine power (no ELO limitation) to find the best move
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { logger } from '../lib/logger';

// Fixed settings for puzzle mode (max power)
const PUZZLE_SETTINGS = {
  targetElo: 3500,
  limitStrength: false,
  skill: 20,
  multiPv: 3,
  armageddon: 'off' as const,
};

// Delay before auto-triggering (pieces animate during puzzle init)
const AUTO_TRIGGER_DELAY = 1300;

/**
 * Hook that triggers puzzle suggestions.
 * Returns a function to manually trigger a hint.
 *
 * Auto-triggers when:
 * 1. Puzzle is started
 * 2. It's the player's turn (detected from FEN)
 * 3. autoHint is enabled
 * 4. Position has changed
 */
export function usePuzzleSuggestionTrigger() {
  const {
    isStarted,
    playerColor,
    currentFen,
    autoHint,
    requestSuggestion,
  } = usePuzzleStore();
  const { isConnected, send } = useWebSocketStore();

  const lastFen = useRef<string | null>(null);
  const autoTriggerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Manually trigger a hint request
   */
  const triggerHint = useCallback(() => {
    if (!currentFen || !isConnected) {
      logger.log('[puzzle-trigger] Cannot trigger: no FEN or not connected');
      return;
    }

    logger.log('[puzzle-trigger] Manual hint requested');

    const requestId = requestSuggestion();

    send({
      type: 'suggestion',
      requestId,
      fen: currentFen,
      moves: [], // No move history for puzzles
      puzzleMode: true,
      ...PUZZLE_SETTINGS,
    });
  }, [currentFen, isConnected, requestSuggestion, send]);

  // Auto-trigger effect
  useEffect(() => {
    logger.log(`[puzzle-trigger] Effect: isStarted=${isStarted}, isConnected=${isConnected}, autoHint=${autoHint}, hasFen=${!!currentFen}`);

    // Clear any pending timeout
    if (autoTriggerTimeout.current) {
      clearTimeout(autoTriggerTimeout.current);
      autoTriggerTimeout.current = null;
    }

    // Check conditions
    if (!isStarted) {
      logger.log('[puzzle-trigger] Skip: puzzle not started');
      return;
    }
    if (!isConnected) {
      logger.log('[puzzle-trigger] Skip: not connected');
      return;
    }
    if (!currentFen) {
      logger.log('[puzzle-trigger] Skip: no FEN');
      return;
    }
    if (!autoHint) {
      logger.log('[puzzle-trigger] Skip: autoHint disabled');
      return;
    }

    // Check if it's the player's turn (from FEN)
    const turnFromFen = currentFen.split(' ')[1]; // 'w' or 'b'
    const playerTurnChar = playerColor === 'white' ? 'w' : 'b';
    const isPlayerTurn = turnFromFen === playerTurnChar;

    logger.log(`[puzzle-trigger] Turn check: FEN turn=${turnFromFen}, playerColor=${playerColor} (${playerTurnChar}), isPlayerTurn=${isPlayerTurn}`);

    if (!isPlayerTurn) {
      logger.log('[puzzle-trigger] Skip: not player turn');
      return;
    }

    // Check if position changed
    if (currentFen === lastFen.current) {
      logger.log('[puzzle-trigger] Skip: same position');
      return;
    }

    logger.log(`[puzzle-trigger] Position changed! Old: ${lastFen.current?.split(' ')[0]}, New: ${currentFen.split(' ')[0]}`);
    logger.log(`[puzzle-trigger] Waiting ${AUTO_TRIGGER_DELAY}ms before sending request...`);

    // Delay before sending (pieces animate during puzzle init)
    autoTriggerTimeout.current = setTimeout(() => {
      // Re-check FEN hasn't changed during delay
      const currentStoreFen = usePuzzleStore.getState().currentFen;
      if (currentStoreFen !== currentFen) {
        logger.log('[puzzle-trigger] FEN changed during delay, skipping');
        return;
      }

      lastFen.current = currentFen;
      logger.log('[puzzle-trigger] >>> Sending suggestion request');

      const requestId = requestSuggestion();

      send({
        type: 'suggestion',
        requestId,
        fen: currentFen,
        moves: [],
        puzzleMode: true,
        ...PUZZLE_SETTINGS,
      });

      logger.log(`[puzzle-trigger] Sent request ${requestId}`);
    }, AUTO_TRIGGER_DELAY);

    return () => {
      if (autoTriggerTimeout.current) {
        clearTimeout(autoTriggerTimeout.current);
        autoTriggerTimeout.current = null;
      }
    };
  }, [
    isStarted,
    playerColor,
    currentFen,
    autoHint,
    isConnected,
    requestSuggestion,
    send,
  ]);

  // Clear last FEN when puzzle resets
  useEffect(() => {
    if (!isStarted) {
      lastFen.current = null;
    }
  }, [isStarted]);

  return triggerHint;
}
