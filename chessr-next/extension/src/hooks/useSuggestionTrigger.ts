/**
 * useSuggestionTrigger - Auto-trigger suggestions when it's player's turn
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useEngineStore } from '../stores/engineStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { logger } from '../lib/logger';

const DEBOUNCE_MS = 300;

/**
 * Hook that automatically triggers suggestion requests when:
 * 1. It's the player's turn
 * 2. The position has changed
 * 3. Settings changed (targetElo, riskTaking, personality)
 * 4. WebSocket is connected
 */
export function useSuggestionTrigger() {
  const { isGameStarted, playerColor, currentTurn, chessInstance, getUciMoves } =
    useGameStore();
  const { getTargetElo, personality, riskTaking, skill, armageddon, disableLimitStrength, targetEloAuto, targetEloManual, userElo } = useEngineStore();
  const { numberOfSuggestions } = useSettingsStore();
  const { requestSuggestions } = useSuggestionStore();
  const { isConnected, send } = useWebSocketStore();

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFen = useRef<string | null>(null);

  // Combined effect for position and settings changes
  useEffect(() => {
    // Check all conditions
    if (!isGameStarted || !isConnected || !chessInstance) {
      return;
    }

    // Is it player's turn?
    const isPlayerTurn = playerColor === currentTurn;
    if (!isPlayerTurn) {
      return;
    }

    const fen = chessInstance.fen();
    const isPositionChange = fen !== lastFen.current;

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    const sendRequest = () => {
      const targetElo = getTargetElo();
      const moves = getUciMoves();

      logger.log(`Requesting suggestions for position (contempt: ${riskTaking}, moves: ${moves.length})`);

      lastFen.current = fen;

      // Create request and get ID
      const requestId = requestSuggestions(
        fen,
        targetElo,
        personality,
        numberOfSuggestions
      );

      // Send WebSocket message with moves for game context
      // Contempt is from side-to-move perspective (no inversion needed)
      send({
        type: 'suggestion',
        requestId,
        fen,
        moves,
        targetElo,
        personality,
        multiPv: numberOfSuggestions,
        contempt: riskTaking,
        skill,
        armageddon,
        limitStrength: !disableLimitStrength,
      });
    };

    if (isPositionChange) {
      // Position change = immediate request
      sendRequest();
    } else {
      // Settings change = debounced request
      debounceTimer.current = setTimeout(sendRequest, DEBOUNCE_MS);
    }

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [
    isGameStarted,
    playerColor,
    currentTurn,
    chessInstance,
    isConnected,
    getTargetElo,
    getUciMoves,
    personality,
    riskTaking,
    skill,
    armageddon,
    disableLimitStrength,
    targetEloAuto,
    targetEloManual,
    userElo,
    numberOfSuggestions,
    requestSuggestions,
    send,
  ]);

  // Clear last FEN when game resets
  useEffect(() => {
    if (!isGameStarted) {
      lastFen.current = null;
    }
  }, [isGameStarted]);
}
