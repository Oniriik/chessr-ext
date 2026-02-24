/**
 * useSuggestionTrigger - Auto-trigger suggestions when it's player's turn
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useEngineStore } from '../stores/engineStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { useAuthStore } from '../stores/authStore';
import { logger } from '../lib/logger';
import { validateEngineSettings, showUpgradeAlert, FREE_LIMITS, isPremium } from '../lib/planUtils';

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
  const plan = useAuthStore((state) => state.plan);

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
      const premium = isPremium(plan);

      // Validate settings against plan limits
      const validationError = validateEngineSettings(plan, {
        targetElo,
        personality,
        armageddon,
      });

      if (validationError) {
        showUpgradeAlert(validationError);
        return;
      }

      // For free users, force risk and skill to their limit values
      const effectiveRisk = premium ? riskTaking : FREE_LIMITS.maxRisk;
      const effectiveSkill = premium ? skill : FREE_LIMITS.maxSkill;
      const effectiveElo = premium ? targetElo : Math.min(targetElo, FREE_LIMITS.maxElo);

      logger.log(`Requesting suggestions for position (contempt: ${effectiveRisk}, moves: ${moves.length})`);

      lastFen.current = fen;

      // Create request and get ID
      const requestId = requestSuggestions(
        fen,
        effectiveElo,
        personality,
        numberOfSuggestions
      );

      // Send WebSocket message with moves for game context
      // Contempt is from side-to-move perspective (no inversion needed)
      // Armageddon: convert boolean + playerColor to 'off' | 'white' | 'black'
      const armageddonMode = armageddon && playerColor ? playerColor : 'off';

      send({
        type: 'suggestion',
        requestId,
        fen,
        moves,
        targetElo: effectiveElo,
        personality,
        multiPv: numberOfSuggestions,
        contempt: effectiveRisk,
        skill: effectiveSkill,
        armageddon: armageddonMode,
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
    plan,
  ]);

  // Clear last FEN when game resets
  useEffect(() => {
    if (!isGameStarted) {
      lastFen.current = null;
    }
  }, [isGameStarted]);
}
