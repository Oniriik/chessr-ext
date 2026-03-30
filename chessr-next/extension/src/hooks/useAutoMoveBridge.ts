/**
 * Bridge between the extension's suggestion system and the desktop
 * app's auto-move feature.
 *
 * Sends board_state messages to the desktop app (via Maia WebSocket)
 * whenever suggestions are available, regardless of which engine
 * produced them.
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { usePlatform } from '../contexts/PlatformContext';
import { maiaWebSocketManager } from '../lib/maiaWebSocket';
import { getScreenBoardRect } from '../lib/boardCoords';

export function useAutoMoveBridge() {
  const { platform } = usePlatform();
  const platformId = platform.id as 'lichess' | 'chesscom';
  const lastSentRef = useRef<string>('');

  useEffect(() => {
    // Subscribe to both stores and send board_state on changes
    const unsubSuggestions = useSuggestionStore.subscribe((state) => {
      const { suggestions } = state;
      const { isGameStarted, playerColor, currentTurn } = useGameStore.getState();

      if (!isGameStarted) return;

      const isPlayerTurn = playerColor === currentTurn;

      // Build a dedup key to avoid sending the same state repeatedly
      const key = `${isPlayerTurn}-${suggestions.map((s) => s.move).join(',')}`;
      if (key === lastSentRef.current) return;
      lastSentRef.current = key;

      const boardRect = getScreenBoardRect(platformId);
      if (!boardRect) return;

      const isFlipped = playerColor === 'black';

      maiaWebSocketManager.sendBoardState(
        suggestions.map((s) => ({
          move: s.move,
          confidence: s.confidence ?? 0,
          winRate: s.winRate ?? 50,
        })),
        boardRect,
        isFlipped,
        isPlayerTurn,
      );
    });

    // Also subscribe to game store for turn changes
    const unsubGame = useGameStore.subscribe((state) => {
      const { isGameStarted, playerColor, currentTurn } = state;

      if (!isGameStarted) return;

      const isPlayerTurn = playerColor === currentTurn;

      // When it's no longer our turn, notify desktop app
      if (!isPlayerTurn) {
        const boardRect = getScreenBoardRect(platformId);
        if (!boardRect) return;

        const key = `${isPlayerTurn}-noturn`;
        if (key === lastSentRef.current) return;
        lastSentRef.current = key;

        maiaWebSocketManager.sendBoardState(
          [],
          boardRect,
          playerColor === 'black',
          false,
        );
      }
    });

    return () => {
      unsubSuggestions();
      unsubGame();
    };
  }, [platformId]);
}
