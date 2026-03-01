/**
 * useSuggestionTrigger - Auto-trigger suggestions when it's player's turn
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useEngineStore } from '../stores/engineStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useWebSocketStore } from '../stores/webSocketStore';
import { useMaiaWebSocketStore } from '../stores/maiaWebSocketStore';
import { maiaWebSocketManager } from '../lib/maiaWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useNeedsLinking } from '../stores/linkedAccountsStore';
import { logger } from '../lib/logger';
import { validateEngineSettings, showUpgradeAlert, FREE_LIMITS, isPremium } from '../lib/planUtils';

const DEBOUNCE_MS = 300;

/**
 * Hook that automatically triggers suggestion requests when:
 * 1. It's the player's turn
 * 2. The position has changed
 * 3. Settings changed (targetElo, ambition, personality)
 * 4. WebSocket is connected (server or Maia depending on engine)
 */
export function useSuggestionTrigger() {
  const { isGameStarted, playerColor, currentTurn, chessInstance, getUciMoves } =
    useGameStore();
  const {
    selectedEngine, getMaiaEloSelf, getMaiaEloOppo,
    getTargetElo, personality, ambition, ambitionAuto, variety, armageddon,
    disableLimitStrength, searchMode, searchNodes, searchDepth, searchMovetime,
    targetEloAuto, autoEloBoost, targetEloManual, userElo,
  } = useEngineStore();
  const { numberOfSuggestions } = useSettingsStore();
  const { requestSuggestions } = useSuggestionStore();
  const { isConnected: isServerConnected, send } = useWebSocketStore();
  const { isConnected: isMaiaConnected, connect: connectMaia, disconnect: disconnectMaia, maiaLoggedIn, maiaPlan } = useMaiaWebSocketStore();
  const plan = useAuthStore((state) => state.plan);
  const needsLinking = useNeedsLinking();

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFen = useRef<string | null>(null);

  // Auto-connect/disconnect Maia WS based on engine selection
  useEffect(() => {
    if (selectedEngine === 'maia2') {
      connectMaia();
    } else {
      disconnectMaia();
    }
  }, [selectedEngine, connectMaia, disconnectMaia]);

  // Determine if we're ready to send
  // For Maia: must be connected AND logged in with a non-free plan
  const isMaiaReady = isMaiaConnected && maiaLoggedIn && maiaPlan !== 'free';
  const isReady = selectedEngine === 'maia2' ? isMaiaReady : isServerConnected;

  // Combined effect for position and settings changes
  useEffect(() => {
    // Check all conditions
    if (!isGameStarted || !isReady || !chessInstance || needsLinking) {
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
      if (selectedEngine === 'maia2') {
        // --- Maia-2: send to local WebSocket ---
        const eloSelf = getMaiaEloSelf();
        const eloOppo = getMaiaEloOppo();
        logger.log(`[Maia] Requesting suggestion for position (elo: ${eloSelf} vs ${eloOppo})`);
        lastFen.current = fen;

        const requestId = requestSuggestions(fen, eloSelf, 'Maia-2', numberOfSuggestions);
        maiaWebSocketManager.sendSuggestion(requestId, fen, eloSelf, eloOppo, numberOfSuggestions);
      } else {
        // --- Default: send to server ---
        const targetElo = getTargetElo();
        const moves = getUciMoves();
        const premium = isPremium(plan);

        const validationError = validateEngineSettings(plan, {
          targetElo,
          personality,
          armageddon,
        });

        if (validationError) {
          showUpgradeAlert(validationError);
          return;
        }

        const effectiveAmbition = (ambitionAuto || !premium) ? undefined : ambition;
        const effectiveVariety = premium ? variety : 0;
        const effectiveElo = premium ? targetElo : Math.min(targetElo, FREE_LIMITS.maxElo);

        logger.log(`Requesting suggestions for position (contempt: ${effectiveAmbition ?? 'auto'}, moves: ${moves.length})`);
        lastFen.current = fen;

        const requestId = requestSuggestions(fen, effectiveElo, personality, numberOfSuggestions);

        const armageddonMode = armageddon && playerColor ? playerColor : 'off';

        send({
          type: 'suggestion',
          requestId,
          fen,
          moves,
          targetElo: effectiveElo,
          personality,
          multiPv: numberOfSuggestions,
          ...(effectiveAmbition !== undefined ? { contempt: effectiveAmbition } : {}),
          variety: effectiveVariety,
          armageddon: armageddonMode,
          limitStrength: !disableLimitStrength,
          ...(disableLimitStrength ? {
            searchMode,
            ...(searchMode === 'nodes' ? { searchNodes } : {}),
            ...(searchMode === 'depth' ? { searchDepth } : {}),
            ...(searchMode === 'movetime' ? { searchMovetime } : {}),
          } : {}),
        });
      }
    };

    if (isPositionChange) {
      sendRequest();
    } else {
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
    isReady,
    needsLinking,
    selectedEngine,
    getMaiaEloSelf,
    getMaiaEloOppo,
    getTargetElo,
    getUciMoves,
    personality,
    ambition,
    ambitionAuto,
    variety,
    armageddon,
    disableLimitStrength,
    searchMode,
    searchNodes,
    searchDepth,
    searchMovetime,
    targetEloAuto,
    autoEloBoost,
    targetEloManual,
    userElo,
    numberOfSuggestions,
    requestSuggestions,
    send,
    plan,
    maiaLoggedIn,
    maiaPlan,
  ]);

  // Clear last FEN when game resets
  useEffect(() => {
    if (!isGameStarted) {
      lastFen.current = null;
    }
  }, [isGameStarted]);
}
