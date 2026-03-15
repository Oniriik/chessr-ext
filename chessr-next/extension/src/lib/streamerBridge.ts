/**
 * Streamer Bridge
 * Runs in the content script context.
 * Connects to the background service worker and relays store state
 * to the streamer page. Receives streamer_status to toggle UI visibility.
 */

import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useOpeningStore } from '../stores/openingStore';
import { useAccuracyStore } from '../stores/accuracyStore';
import { useLinkedAccountsStore } from '../stores/linkedAccountsStore';
import { useDiscordStore } from '../stores/discordStore';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useStreamerModeStore } from '../stores/streamerModeStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useEngineStore } from '../stores/engineStore';

let port: chrome.runtime.Port | null = null;
let unsubscribers: (() => void)[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function sendMessage(message: unknown) {
  if (!port) return;
  try {
    port.postMessage(message);
  } catch {
    // Port disconnected, will reconnect
  }
}

function subscribeToStores() {
  // Unsubscribe previous listeners
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];

  // Game state
  unsubscribers.push(
    useGameStore.subscribe((state, prevState) => {
      if (
        state.isGameStarted !== prevState.isGameStarted ||
        state.playerColor !== prevState.playerColor ||
        state.currentTurn !== prevState.currentTurn ||
        state.chessInstance !== prevState.chessInstance ||
        state.moveHistory !== prevState.moveHistory
      ) {
        sendMessage({
          type: 'game_state',
          isGameStarted: state.isGameStarted,
          playerColor: state.playerColor,
          currentTurn: state.currentTurn,
          fen: state.chessInstance?.fen() ?? null,
          moveHistory: state.moveHistory,
        });
      }
    })
  );

  // Suggestions
  unsubscribers.push(
    useSuggestionStore.subscribe((state, prevState) => {
      if (
        state.suggestions !== prevState.suggestions ||
        state.isLoading !== prevState.isLoading ||
        state.selectedIndex !== prevState.selectedIndex ||
        state.hoveredIndex !== prevState.hoveredIndex ||
        state.showingPvIndex !== prevState.showingPvIndex ||
        state.showingOpeningMoves !== prevState.showingOpeningMoves ||
        state.showingAlternativeIndex !== prevState.showingAlternativeIndex
      ) {
        sendMessage({
          type: 'suggestions',
          suggestions: state.suggestions,
          positionEval: state.positionEval,
          mateIn: state.mateIn,
          winRate: state.winRate,
          suggestedFen: state.suggestedFen,
          isLoading: state.isLoading,
          selectedIndex: state.selectedIndex,
          hoveredIndex: state.hoveredIndex,
          showingPvIndex: state.showingPvIndex,
          showingOpeningMoves: state.showingOpeningMoves,
          showingAlternativeIndex: state.showingAlternativeIndex,
        });
      }
    })
  );

  // Opening
  unsubscribers.push(
    useOpeningStore.subscribe((state, prevState) => {
      if (
        state.isInBook !== prevState.isInBook ||
        state.openingName !== prevState.openingName ||
        state.eco !== prevState.eco ||
        state.bookMoves !== prevState.bookMoves ||
        state.deviationDetected !== prevState.deviationDetected ||
        state.deviationMove !== prevState.deviationMove
      ) {
        sendMessage({
          type: 'opening',
          isInBook: state.isInBook,
          openingName: state.openingName,
          eco: state.eco,
          bookMoves: state.bookMoves,
          deviationDetected: state.deviationDetected,
          deviationMove: state.deviationMove,
        });
      }
    })
  );

  // Accuracy
  unsubscribers.push(
    useAccuracyStore.subscribe((state, prevState) => {
      if (
        state.accuracy !== prevState.accuracy ||
        state.accuracyTrend !== prevState.accuracyTrend ||
        state.moveAnalyses !== prevState.moveAnalyses
      ) {
        sendMessage({
          type: 'accuracy',
          accuracy: state.accuracy,
          accuracyTrend: state.accuracyTrend,
          moveAnalyses: state.moveAnalyses,
        });
      }
    })
  );

  // Linked accounts
  unsubscribers.push(
    useLinkedAccountsStore.subscribe((state, prevState) => {
      if (state.accounts !== prevState.accounts) {
        sendMessage({
          type: 'linked_accounts',
          accounts: state.accounts,
        });
      }
    })
  );

  // Discord
  unsubscribers.push(
    useDiscordStore.subscribe((state, prevState) => {
      if (
        state.isLinked !== prevState.isLinked ||
        state.discordUsername !== prevState.discordUsername ||
        state.discordAvatar !== prevState.discordAvatar
      ) {
        sendMessage({
          type: 'discord',
          isLinked: state.isLinked,
          discordUsername: state.discordUsername,
          discordAvatar: state.discordAvatar,
        });
      }
    })
  );

  // Settings (eval bar)
  unsubscribers.push(
    useSettingsStore.subscribe((state, prevState) => {
      if (
        state.showEvalBar !== prevState.showEvalBar ||
        state.evalBarMode !== prevState.evalBarMode
      ) {
        sendMessage({
          type: 'settings',
          showEvalBar: state.showEvalBar,
          evalBarMode: state.evalBarMode,
        });
      }
    })
  );

  // Engine
  unsubscribers.push(
    useEngineStore.subscribe((state, prevState) => {
      if (state.selectedEngine !== prevState.selectedEngine) {
        sendMessage({
          type: 'engine',
          selectedEngine: state.selectedEngine,
        });
      }
    })
  );

  // Puzzle state
  unsubscribers.push(
    usePuzzleStore.subscribe((state, prevState) => {
      if (
        state.isStarted !== prevState.isStarted ||
        state.isSolved !== prevState.isSolved ||
        state.playerColor !== prevState.playerColor ||
        state.currentFen !== prevState.currentFen ||
        state.suggestions !== prevState.suggestions ||
        state.suggestion !== prevState.suggestion ||
        state.isLoading !== prevState.isLoading
      ) {
        sendMessage({
          type: 'puzzle_state',
          isStarted: state.isStarted,
          isSolved: state.isSolved,
          playerColor: state.playerColor,
          currentFen: state.currentFen,
          suggestions: state.suggestions,
          suggestion: state.suggestion,
          isLoading: state.isLoading,
        });
      }
    })
  );
}

function sendFullState() {
  const game = useGameStore.getState();
  sendMessage({
    type: 'game_state',
    isGameStarted: game.isGameStarted,
    playerColor: game.playerColor,
    currentTurn: game.currentTurn,
    fen: game.chessInstance?.fen() ?? null,
    moveHistory: game.moveHistory,
  });

  const suggestions = useSuggestionStore.getState();
  sendMessage({
    type: 'suggestions',
    suggestions: suggestions.suggestions,
    positionEval: suggestions.positionEval,
    mateIn: suggestions.mateIn,
    winRate: suggestions.winRate,
    suggestedFen: suggestions.suggestedFen,
    isLoading: suggestions.isLoading,
    selectedIndex: suggestions.selectedIndex,
    hoveredIndex: suggestions.hoveredIndex,
    showingPvIndex: suggestions.showingPvIndex,
    showingOpeningMoves: suggestions.showingOpeningMoves,
    showingAlternativeIndex: suggestions.showingAlternativeIndex,
  });

  const opening = useOpeningStore.getState();
  sendMessage({
    type: 'opening',
    isInBook: opening.isInBook,
    openingName: opening.openingName,
    eco: opening.eco,
    bookMoves: opening.bookMoves,
    deviationDetected: opening.deviationDetected,
    deviationMove: opening.deviationMove,
  });

  const accuracy = useAccuracyStore.getState();
  sendMessage({
    type: 'accuracy',
    accuracy: accuracy.accuracy,
    accuracyTrend: accuracy.accuracyTrend,
    moveAnalyses: accuracy.moveAnalyses,
  });

  const linkedAccounts = useLinkedAccountsStore.getState();
  sendMessage({
    type: 'linked_accounts',
    accounts: linkedAccounts.accounts,
  });

  const discord = useDiscordStore.getState();
  sendMessage({
    type: 'discord',
    isLinked: discord.isLinked,
    discordUsername: discord.discordUsername,
    discordAvatar: discord.discordAvatar,
  });

  const settings = useSettingsStore.getState();
  sendMessage({
    type: 'settings',
    showEvalBar: settings.showEvalBar,
    evalBarMode: settings.evalBarMode,
  });

  const engine = useEngineStore.getState();
  sendMessage({
    type: 'engine',
    selectedEngine: engine.selectedEngine,
  });

  const puzzle = usePuzzleStore.getState();
  sendMessage({
    type: 'puzzle_state',
    isStarted: puzzle.isStarted,
    isSolved: puzzle.isSolved,
    playerColor: puzzle.playerColor,
    currentFen: puzzle.currentFen,
    suggestions: puzzle.suggestions,
    suggestion: puzzle.suggestion,
    isLoading: puzzle.isLoading,
  });
}

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'content-script' });
  } catch {
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener((message) => {
    if (message.type === 'streamer_status') {
      useStreamerModeStore.getState().setStreamerTabOpen(message.isOpen);
      // Send full state when streamer connects
      if (message.isOpen) {
        sendFullState();
      }
    }
  });

  port.onDisconnect.addListener(() => {
    port = null;
    // Reset streamer mode — if streamer is still open,
    // the service worker will re-send streamer_status:true on reconnect
    useStreamerModeStore.getState().setStreamerTabOpen(false);
    scheduleReconnect();
  });

  subscribeToStores();
  startKeepalive();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

function startKeepalive() {
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = setInterval(() => {
    sendMessage({ type: 'keepalive' });
  }, 25000);
}

export function initStreamerBridge() {
  connect();
}
