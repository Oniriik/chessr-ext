/**
 * usePuzzleSuggestionTrigger - Trigger suggestions for puzzles
 * Supports both Komodo (server) and Maia-2 (local) engines
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { useMaiaWebSocketStore } from '../stores/maiaWebSocketStore';
import { maiaWebSocketManager } from '../lib/maiaWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useNeedsLinking } from '../stores/linkedAccountsStore';
import { logger } from '../lib/logger';
import { isPremium, showUpgradeAlert } from '../lib/planUtils';

// Maia "full power" = highest ELO values for strongest predictions
const MAIA_MAX_ELO = 3000;

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
    puzzleEngine,
    searchMode,
    searchNodes,
    searchDepth,
    searchMovetime,
    requestSuggestion,
  } = usePuzzleStore();
  const { isConnected: isServerConnected, send } = useWebSocketStore();
  const { isConnected: isMaiaConnected, connect: connectMaia, disconnect: disconnectMaia } = useMaiaWebSocketStore();
  const plan = useAuthStore((state) => state.plan);
  const needsLinking = useNeedsLinking();

  const lastFen = useRef<string | null>(null);

  // Auto-connect/disconnect Maia WS based on puzzle engine selection
  // Reset lastFen so auto-trigger re-fires with new engine
  useEffect(() => {
    if (puzzleEngine === 'maia2') {
      connectMaia();
    } else {
      disconnectMaia();
    }
    lastFen.current = null;
  }, [puzzleEngine, connectMaia, disconnectMaia]);

  // Determine readiness based on selected engine
  const isConnected = puzzleEngine === 'maia2' ? isMaiaConnected : isServerConnected;

  /**
   * Send a suggestion request for the given FEN
   */
  const sendRequest = useCallback((fen: string) => {
    const requestId = requestSuggestion();

    if (puzzleEngine === 'maia2') {
      // Maia-2: send to local WebSocket at full power
      maiaWebSocketManager.sendSuggestion(requestId, fen, MAIA_MAX_ELO, MAIA_MAX_ELO, 3);
      logger.log(`[puzzle-trigger] Sent Maia request ${requestId} (full power)`);
    } else {
      // Komodo: send to server at full power
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
      logger.log(`[puzzle-trigger] Sent Komodo request ${requestId}`);
    }
  }, [puzzleEngine, requestSuggestion, send, searchMode, searchNodes, searchDepth, searchMovetime]);

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
    puzzleEngine,
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
