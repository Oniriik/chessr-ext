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

  /**
   * Send a suggestion request for the given FEN
   */
  const sendRequest = useCallback((fen: string) => {
    const requestId = requestSuggestion();

    send({
      type: 'suggestion',
      requestId,
      fen,
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
  }, [requestSuggestion, send, searchMode, searchNodes, searchDepth, searchMovetime]);

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
    sendRequest(currentFen);
  }, [currentFen, isConnected, needsLinking, plan, sendRequest]);

  // Auto-trigger effect (no delay - sends immediately on position change)
  useEffect(() => {
    // Check conditions
    if (!isStarted || !isConnected || needsLinking || !currentFen || !autoHint) {
      return;
    }
    // Check premium access (no alert for auto-trigger, just skip silently)
    if (!isPremium(plan)) {
      return;
    }

    // Check if it's the player's turn (from FEN)
    const turnFromFen = currentFen.split(' ')[1]; // 'w' or 'b'
    const playerTurnChar = playerColor === 'white' ? 'w' : 'b';
    if (turnFromFen !== playerTurnChar) {
      return;
    }

    // Check if position changed
    if (currentFen === lastFen.current) {
      return;
    }

    logger.log(`[puzzle-trigger] Position changed, sending immediately`);
    lastFen.current = currentFen;
    sendRequest(currentFen);
  }, [
    isStarted,
    playerColor,
    currentFen,
    autoHint,
    isConnected,
    needsLinking,
    sendRequest,
    plan,
  ]);

  // Clear last FEN when puzzle resets
  useEffect(() => {
    if (!isStarted) {
      lastFen.current = null;
    }
  }, [isStarted]);

  return triggerHint;
}
