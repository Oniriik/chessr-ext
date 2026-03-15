/**
 * useStreamerPort - Manages the port connection from the streamer page
 * to the background service worker. Receives game state and suggestions
 * from the content script and populates local Zustand stores.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useOpeningStore } from '../stores/openingStore';
import { useAccuracyStore } from '../stores/accuracyStore';
import { useLinkedAccountsStore } from '../stores/linkedAccountsStore';
import { useDiscordStore } from '../stores/discordStore';
import { usePuzzleStore, type PuzzleSuggestion } from '../stores/puzzleStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useEngineStore, type SelectedEngine } from '../stores/engineStore';

export function useStreamerPort() {
  const [isConnected, setIsConnected] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((message: Record<string, unknown>) => {
    switch (message.type) {
      case 'game_state': {
        const gameStore = useGameStore.getState();
        gameStore.setGameStarted(message.isGameStarted as boolean);
        gameStore.setPlayerColor(message.playerColor as 'white' | 'black' | null);
        gameStore.setCurrentTurn(message.currentTurn as 'white' | 'black');

        // Rebuild chess instance from FEN if available
        const fen = message.fen as string | null;
        const moveHistory = message.moveHistory as string[];
        if (fen) {
          try {
            // Replay moves to build chess instance
            const chess = new Chess();
            for (const move of moveHistory) {
              chess.move(move);
            }
            useGameStore.setState({
              chessInstance: chess,
              moveHistory,
            });
          } catch {
            // Fallback: just set from FEN
            try {
              const chess = new Chess(fen);
              useGameStore.setState({
                chessInstance: chess,
                moveHistory,
              });
            } catch {
              // Ignore
            }
          }
        } else {
          useGameStore.setState({
            chessInstance: null,
            moveHistory: [],
          });
        }
        break;
      }

      case 'suggestions': {
        useSuggestionStore.setState({
          suggestions: message.suggestions as typeof useSuggestionStore extends { getState: () => infer S } ? S extends { suggestions: infer T } ? T : never : never,
          positionEval: message.positionEval as number | null,
          mateIn: message.mateIn as number | null,
          winRate: message.winRate as number | null,
          suggestedFen: message.suggestedFen as string | null,
          isLoading: message.isLoading as boolean,
          selectedIndex: message.selectedIndex as number,
          hoveredIndex: message.hoveredIndex as number | null,
          showingPvIndex: message.showingPvIndex as number | null,
          showingOpeningMoves: message.showingOpeningMoves as boolean,
          showingAlternativeIndex: message.showingAlternativeIndex as number | null,
        });
        break;
      }

      case 'opening': {
        useOpeningStore.setState({
          isInBook: message.isInBook as boolean,
          openingName: message.openingName as string | null,
          eco: message.eco as string | null,
          bookMoves: message.bookMoves as typeof useOpeningStore extends { getState: () => infer S } ? S extends { bookMoves: infer T } ? T : never : never,
          deviationDetected: message.deviationDetected as boolean,
          deviationMove: message.deviationMove as string | null,
        });
        break;
      }

      case 'accuracy': {
        useAccuracyStore.setState({
          accuracy: message.accuracy as number,
          accuracyTrend: message.accuracyTrend as 'up' | 'down' | 'stable',
          moveAnalyses: message.moveAnalyses as typeof useAccuracyStore extends { getState: () => infer S } ? S extends { moveAnalyses: infer T } ? T : never : never,
        });
        break;
      }

      case 'linked_accounts': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useLinkedAccountsStore.getState().setAccounts(message.accounts as any);
        break;
      }

      case 'discord': {
        useDiscordStore.getState().setLinked(
          message.isLinked as boolean,
          message.discordUsername as string | null,
          message.discordAvatar as string | null,
        );
        break;
      }

      case 'settings': {
        useSettingsStore.setState({
          showEvalBar: message.showEvalBar as boolean,
          evalBarMode: message.evalBarMode as 'eval' | 'winrate',
        });
        break;
      }

      case 'engine': {
        useEngineStore.setState({
          selectedEngine: message.selectedEngine as SelectedEngine,
        });
        break;
      }

      case 'puzzle_state': {
        usePuzzleStore.setState({
          isStarted: message.isStarted as boolean,
          isSolved: message.isSolved as boolean,
          playerColor: message.playerColor as 'white' | 'black' | null,
          currentFen: message.currentFen as string | null,
          suggestions: message.suggestions as PuzzleSuggestion[],
          suggestion: message.suggestion as PuzzleSuggestion | null,
          isLoading: message.isLoading as boolean,
        });
        break;
      }
    }
  }, []);

  const connect = useCallback(() => {
    try {
      const port = chrome.runtime.connect({ name: 'streamer' });
      portRef.current = port;
      setIsConnected(true);

      port.onMessage.addListener(handleMessage);

      port.onDisconnect.addListener(() => {
        portRef.current = null;
        setIsConnected(false);
        // Schedule reconnect
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 2000);
      });
    } catch {
      setIsConnected(false);
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 2000);
    }
  }, [handleMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (portRef.current) {
        portRef.current.disconnect();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((message: unknown) => {
    if (portRef.current) {
      try {
        portRef.current.postMessage(message);
      } catch {
        // Port disconnected
      }
    }
  }, []);

  return { isConnected, sendMessage };
}
