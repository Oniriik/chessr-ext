/**
 * usePuzzleSuggestionTrigger - Trigger suggestions for puzzles
 * Uses max engine power (no ELO limitation) to find the best move
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { useAuthStore } from '../stores/authStore';
import { useNeedsLinking } from '../stores/linkedAccountsStore';
import { logger } from '../lib/logger';
import { isPremium, showUpgradeAlert } from '../lib/planUtils';

// Delay before auto-triggering (after player color is detected)
const AUTO_TRIGGER_DELAY = 400;

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
    searchMode,
    searchNodes,
    searchDepth,
    searchMovetime,
    requestSuggestion,
  } = usePuzzleStore();
  const { isConnected, send } = useWebSocketStore();
  const plan = useAuthStore((state) => state.plan);
  const needsLinking = useNeedsLinking();

  const lastFen = useRef<string | null>(null);
  const autoTriggerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Manually trigger a hint request
   */
  const triggerHint = useCallback(() => {
    if (!currentFen || !isConnected || needsLinking) {
      logger.log('[puzzle-trigger] Cannot trigger: no FEN or not connected or needs linking');
      return;
    }

    // Check premium access
    if (!isPremium(plan)) {
      showUpgradeAlert('Puzzle hints require a premium subscription.');
      return;
    }

    logger.log('[puzzle-trigger] Manual hint requested');

    const requestId = requestSuggestion();

    send({
      type: 'suggestion',
      requestId,
      fen: currentFen,
      moves: [],
      puzzleMode: true,
      targetElo: 3500,
      limitStrength: false,
      multiPv: 3,
      armageddon: 'off',
      searchMode,
      ...(searchMode === 'nodes' ? { searchNodes } : {}),
      ...(searchMode === 'depth' ? { searchDepth } : {}),
      ...(searchMode === 'movetime' ? { searchMovetime } : {}),
    });
  }, [currentFen, isConnected, needsLinking, requestSuggestion, send, plan, searchMode, searchNodes, searchDepth, searchMovetime]);

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
    if (needsLinking) {
      logger.log('[puzzle-trigger] Skip: needs linking');
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
    // Check premium access (no alert for auto-trigger, just skip silently)
    if (!isPremium(plan)) {
      logger.log('[puzzle-trigger] Skip: premium required');
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
        targetElo: 3500,
        limitStrength: false,
        multiPv: 3,
        armageddon: 'off',
        searchMode,
        ...(searchMode === 'nodes' ? { searchNodes } : {}),
        ...(searchMode === 'depth' ? { searchDepth } : {}),
        ...(searchMode === 'movetime' ? { searchMovetime } : {}),
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
    needsLinking,
    requestSuggestion,
    send,
    plan,
    searchMode,
    searchNodes,
    searchDepth,
    searchMovetime,
  ]);

  // Clear last FEN when puzzle resets
  useEffect(() => {
    if (!isStarted) {
      lastFen.current = null;
    }
  }, [isStarted]);

  return triggerHint;
}
