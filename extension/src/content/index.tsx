import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../presentation/App';
import { useAppStore } from '../presentation/store/app.store';
import { useFeedbackStore } from '../presentation/store/feedback.store';
import { useOpeningStore } from '../presentation/store/opening.store';
import { createPlatformAdapter, PlatformAdapter } from './platforms';
import { MoveTracker } from './move-tracker';
import { WebSocketClient } from './websocket-client';
import { OverlayManager } from './overlay/overlay-manager';
import { ArrowRenderer } from './overlay/arrow-renderer';
import { EvalBar } from './overlay/eval-bar';
import { OpeningTracker } from './openings/opening-tracker';
import { BoardConfig, Settings } from '../shared/types';
import { AnalyzeResultResponse, AnalyzeErrorResponse, SuggestionMove } from '../domain/analysis/feedback-types';
import { buildBadges } from '../domain/analysis/feedback-helpers';
import { isUpdateRequired } from '../shared/version';

// Get version info from download page
function getHttpVersionUrl(_wsUrl: string): string {
  // Always use the download page for version info
  return 'https://download.chessr.io/version.json';
}

/**
 * Generate a short request ID (8 characters) for better log readability
 */
function generateShortRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

class Chessr {
  private adapter: PlatformAdapter | null = null;
  private wsClient!: WebSocketClient;
  private moveTracker!: MoveTracker;
  private overlay = new OverlayManager();
  private arrowRenderer!: ArrowRenderer;
  private evalBar = new EvalBar();
  private openingTracker = new OpeningTracker();
  private boardConfig: BoardConfig | null = null;
  private analysisDisabled = false;
  private versionCheckPassed = false;
  private lastRequestId: string | null = null;

  // New game detection
  private lastMoveHistoryLength = 0;
  private lastFirstMove: string | null = null;

  async init() {
    // Create platform adapter
    this.adapter = createPlatformAdapter();
    if (!this.adapter) {
      return; // Unsupported platform
    }

    const store = useAppStore.getState();
    await store.loadSettings();

    // Determine if we're on a game page
    const isGamePage = this.adapter.isAllowedPage() && !this.adapter.isAnalysisDisabledPage();
    store.setIsGamePage(isGamePage);

    // Always check version via HTTP (lightweight, no WebSocket connection)
    const versionOk = await this.checkVersionViaHttp();
    if (!versionOk) {
      // Version check failed - show update modal
      this.mountReactApp();
      return;
    }

    // Always mount React app (sidebar will show appropriate content)
    this.mountReactApp();

    // Only initialize game features on game pages
    if (!isGamePage) {
      return;
    }

    // Initialize move tracker with adapter
    this.moveTracker = new MoveTracker(this.adapter);

    this.setupOpeningCallbacks();

    // Connect to WebSocket for analysis (only on game pages)
    await this.connectToWebSocket();

    this.versionCheckPassed = true;
    this.adapter.waitForBoard((config) => this.onBoardDetected(config));

    useAppStore.subscribe((state, prevState) => {
      if (state.settings !== prevState.settings) {
        this.onSettingsChanged(state.settings, prevState.settings);
      }
      // Re-analyze when player color changes (via toggle or redetect)
      if (state.boardConfig?.playerColor !== prevState.boardConfig?.playerColor) {
        // Update move tracker with new player color
        if (state.boardConfig?.playerColor) {
          this.moveTracker.setPlayerColor(state.boardConfig.playerColor);
        }
        // Update overlay with new isFlipped value
        if (state.boardConfig) {
          const newIsFlipped = state.boardConfig.playerColor === 'black';
          this.overlay.setFlipped(newIsFlipped);
        }
        // Re-analyze current position
        const currentFEN = this.moveTracker.getCurrentFEN();
        if (currentFEN) {
          this.onPositionChange(currentFEN);
        }
      }
      // Re-analyze when user requests it via button
      if (state.reanalyzeCount !== prevState.reanalyzeCount) {
        const currentFEN = this.moveTracker.getCurrentFEN();
        if (currentFEN) {
          this.onPositionChange(currentFEN);
        }
      }
      // Re-detect turn from move list - only analyze if turn actually changed
      if (state.redetectTurnCount !== prevState.redetectTurnCount) {
        const moveCount = this.adapter?.getMoveCount?.() ?? 0;
        const newSideToMove = moveCount % 2 === 0 ? 'w' : 'b';
        // Only trigger analysis if turn changed
        if (newSideToMove !== prevState.sideToMove) {
          // Update store with new turn
          store.setSideToMove(newSideToMove);
          // Trigger analysis if it's now player's turn
          const currentFEN = this.moveTracker.getCurrentFEN();
          if (currentFEN) {
            this.onPositionChange(currentFEN);
          }
        }
      }
    });
  }

  private setupOpeningCallbacks() {
    const openingStore = useOpeningStore.getState();

    // Subscribe to opening state changes
    this.openingTracker.onChange((state) => {
      openingStore.setOpeningState(state);
    });

    // Set callbacks via the store
    openingStore.setCallbacks({
      onSelectOpening: (opening) => {
        this.openingTracker.selectOpening(opening);
      },
      onClearOpening: () => {
        this.openingTracker.clearOpening();
      },
      onSelectCounter: (counter) => {
        this.openingTracker.selectCounterOpening(counter);
      },
      onDeclineCounter: () => {
        this.openingTracker.declineCounter();
      },
    });
  }

  private mountReactApp() {
    const container = document.createElement('div');
    container.id = 'chessr-root';
    container.style.cssText = 'position: fixed; top: 0; right: 0; z-index: 10000;';
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(<App />);
  }

  private async checkVersionViaHttp(): Promise<boolean> {
    const store = useAppStore.getState();
    const versionUrl = getHttpVersionUrl(store.settings.serverUrl);

    try {
      const response = await fetch(versionUrl, { signal: AbortSignal.timeout(5000) });
      console.log('[Chessr] Version check response:', response);
      if (!response.ok) {
        return true; // Server error - allow to proceed
      }

      const versionInfo = await response.json();
      if (isUpdateRequired(versionInfo.minVersion)) {
        store.setUpdateRequired(true, versionInfo.minVersion, versionInfo.downloadUrl);
        return false; // Version check failed
      }

      return true; // Version OK
    } catch {
      // Network error or timeout - allow to proceed
      return true;
    }
  }

  private async connectToWebSocket(): Promise<void> {
    const store = useAppStore.getState();
    this.wsClient = new WebSocketClient(store.settings.serverUrl);

    // Set up message handler for analysis results
    this.wsClient.onMessage((message) => {
      if (message.type === 'analyze_result') {
        this.onAnalyzeResult(message);
      } else if (message.type === 'analyze_error') {
        this.onAnalyzeError(message);
      }
    });

    // Set up connection status handler
    this.wsClient.onConnectionChange((connected) => {
      useAppStore.getState().setConnected(connected);
    });

    // Set up version error handler (server-side version check)
    this.wsClient.onVersionError((versionInfo) => {
      useAppStore.getState().setUpdateRequired(true, versionInfo.minVersion, versionInfo.downloadUrl);
    });

    // Connect to server
    this.wsClient.connect().catch(() => {
      // Server not connected - will retry via reconnection logic
    });
  }

  private async onBoardDetected(config: BoardConfig) {
    this.boardConfig = config;
    const store = useAppStore.getState();
    const openingStore = useOpeningStore.getState();
    store.setBoardConfig(config);

    // Set player color for opening tracker
    this.openingTracker.setPlayerColor(config.playerColor);
    openingStore.setPlayerColor(config.playerColor);

    // Skip analysis features on review/analysis pages
    if (this.analysisDisabled) {
      return;
    }

    // Initialize overlay
    this.overlay.initialize(config.boardElement, config.isFlipped, this.adapter!);
    this.arrowRenderer = new ArrowRenderer(this.overlay);

    // Initialize eval bar
    if (store.settings.showEvalBar) {
      this.evalBar.initialize(config.boardElement);
    }

    // Start tracking moves with player color
    this.moveTracker.start(config.boardElement, config.playerColor);
    this.moveTracker.onPositionChange((fen) => this.onPositionChange(fen));
    this.moveTracker.onMoveDetected((move) => {
      this.onMoveDetected(move);
      // Forward to feedback store
      const feedbackStore = useFeedbackStore.getState();
      feedbackStore.handlePlayerMove(move);
    });
  }

  private onMoveDetected(move: string) {
    // Forward move to opening tracker
    this.openingTracker.onMove(move);
  }


  private onPositionChange(fen: string) {
    const store = useAppStore.getState();
    const { settings, boardConfig } = store;

    const sideToMove = fen.split(' ')[1] as 'w' | 'b';
    store.setSideToMove(sideToMove);

    if (!settings.enabled) {
      return;
    }
    if (!this.wsClient?.getConnectionStatus()) {
      return;
    }

    // Use boardConfig from store (can be updated by user via UI)
    const currentBoardConfig = boardConfig || this.boardConfig;
    if (!currentBoardConfig) {
      return;
    }

    const playerColor = currentBoardConfig.playerColor === 'white' ? 'w' : 'b';

    console.log('[Chessr] Position change - Player:', currentBoardConfig.playerColor, '(' + playerColor + ')', 'Side to move:', sideToMove);

    // Only analyze when it's the player's turn
    if (sideToMove !== playerColor) {
      console.log('[Chessr] Not player turn - skipping analysis');
      this.overlay.clearArrows();
      store.setAnalysis(null);
      // Invalidate any pending suggestions since it's no longer player's turn
      this.lastRequestId = null;
      return;
    }

    const moveHistory = this.adapter?.getMoveHistory?.() || [];

    // Detect new game (reset accumulated stats)
    const currentFirstMove = moveHistory.length > 0 ? moveHistory[0] : null;
    const isNewGame =
      (moveHistory.length < this.lastMoveHistoryLength) || // Move count decreased
      (currentFirstMove !== null && currentFirstMove !== this.lastFirstMove); // Different opening

    if (isNewGame && this.lastMoveHistoryLength > 0) {
      console.log('[Chessr] 🎮 New game detected - resetting stats cache');
      const feedbackStore = useFeedbackStore.getState();
      feedbackStore.reset();
      this.openingTracker.reset();
    }

    // Update tracking for next detection
    this.lastMoveHistoryLength = moveHistory.length;
    this.lastFirstMove = currentFirstMove;

    // Generate unique request ID to track this analysis
    const requestId = generateShortRequestId();
    this.lastRequestId = requestId;

    console.log('[Chessr] ✓ Player turn - sending suggestion request, moves:', moveHistory.length, 'requestId:', requestId);
    this.wsClient.analyze(moveHistory, settings, requestId);
  }

  private onAnalyzeResult(result: AnalyzeResultResponse) {
    console.log('[Chessr] Analyze result received, requestId:', result.requestId);

    // Anti-stale: ignore if not the latest request
    if (result.requestId !== this.lastRequestId) {
      console.log('[Chessr] Stale result ignored');
      return;
    }

    // Get current position info
    const currentFen = this.moveTracker.getCurrentFEN();
    const moveHistory = this.adapter?.getMoveHistory?.() || [];

    // Forward to feedback store
    const feedbackStore = useFeedbackStore.getState();
    feedbackStore.handleAnalyzeResult(result, currentFen, moveHistory);

    // Update arrows if enabled
    const store = useAppStore.getState();
    if (store.settings.showArrows && result.payload.suggestions.suggestions.length > 0) {
      this.updateArrowsFromSuggestions(result.payload.suggestions.suggestions);
    }

    // Update eval bar if enabled
    if (store.settings.showEvalBar) {
      const bestSuggestion = result.payload.suggestions.suggestions[0];
      if (bestSuggestion) {
        // Convert score to player POV (scores are in White POV by default)
        const isBlackPlayer = store.boardConfig?.playerColor === 'black';
        const scoreMultiplier = isBlackPlayer ? -1 : 1;

        if (bestSuggestion.score.type === 'mate') {
          this.evalBar.update(0, bestSuggestion.score.value * scoreMultiplier);
        } else {
          this.evalBar.update((bestSuggestion.score.value / 100) * scoreMultiplier);
        }
      }
    }
  }

  private onAnalyzeError(error: AnalyzeErrorResponse) {
    console.error('[Chessr] Analyze error:', error.error);
    const feedbackStore = useFeedbackStore.getState();
    feedbackStore.handleAnalyzeError(error);
  }

  private updateArrowsFromSuggestions(suggestions: SuggestionMove[]) {
    const store = useAppStore.getState();
    this.overlay.clearArrows();

    // Draw arrows for suggestions based on settings
    const numToShow = Math.min(suggestions.length, store.settings.numberOfSuggestions);
    for (let i = 0; i < numToShow; i++) {
      const suggestion = suggestions[i];
      const move = suggestion.move;

      // Extract from/to from UCI move (e.g., "e2e4" -> from: "e2", to: "e4")
      if (move.length < 4) continue;
      const from = move.slice(0, 2);
      const to = move.slice(2, 4);

      const color = store.settings.useDifferentArrowColors
        ? (i === 0 ? store.settings.arrowColors.best : i === 1 ? store.settings.arrowColors.second : store.settings.arrowColors.other)
        : store.settings.singleArrowColor;

      // Build badges from suggestion data and filter based on settings
      const allBadges = buildBadges(suggestion);
      const { showQualityLabels, showEffectLabels } = store.settings;

      // Filter badges based on settings
      let badges: string[] = [];
      if (showQualityLabels || showEffectLabels) {
        badges = allBadges.filter(badge => {
          // Quality badges
          const isQualityBadge =
            badge === 'Best' ||
            badge === 'Safe' ||
            badge === 'Risky' ||
            badge === 'Human' ||
            badge === 'Alt' ||
            badge.includes('Medium risk');

          // Effect badges
          const isEffectBadge =
            badge.startsWith('#') ||   // Mate
            badge.startsWith('+') ||   // Check
            badge.startsWith('x ') ||  // Capture
            badge.includes('Promo');   // Promotion

          return (showQualityLabels && isQualityBadge) || (showEffectLabels && isEffectBadge);
        });
      }

      this.arrowRenderer['drawArrowWithColor']({
        from,
        to,
        color,
        badges
      });
    }
  }

  private onSettingsChanged(settings: Settings, prevSettings: Settings) {
    // Update WebSocket client if URL changed
    if (this.wsClient && settings.serverUrl !== this.wsClient['serverUrl']) {
      this.wsClient.disconnect();
      this.wsClient = new WebSocketClient(settings.serverUrl);
      this.wsClient.onMessage((message) => {
        if (message.type === 'analyze_result') {
          this.onAnalyzeResult(message);
        } else if (message.type === 'analyze_error') {
          this.onAnalyzeError(message);
        }
      });
      this.wsClient.onConnectionChange((connected) => {
        useAppStore.getState().setConnected(connected);
      });
      this.wsClient.connect().catch(() => {});
    }

    // Toggle overlays
    if (!settings.showArrows) {
      this.overlay.clearArrows();
    }

    if (settings.showEvalBar) {
      this.evalBar.show();
    } else {
      this.evalBar.hide();
    }

    // Re-analyze if analysis-related settings changed
    const analysisSettingsChanged =
      settings.targetElo !== prevSettings.targetElo ||
      settings.personality !== prevSettings.personality ||
      settings.depth !== prevSettings.depth ||
      settings.moveTime !== prevSettings.moveTime ||
      settings.searchMode !== prevSettings.searchMode ||
      settings.multiPV !== prevSettings.multiPV;

    if (analysisSettingsChanged) {
      const currentFEN = this.moveTracker.getCurrentFEN();
      if (currentFEN) {
        this.onPositionChange(currentFEN);
      }
    }
  }
}

// Start the extension
const chessr = new Chessr();
chessr.init();

// Watch for URL changes (SPA navigation)
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Re-initialize on URL change
    chessr.init();
  }
});

urlObserver.observe(document.body, {
  childList: true,
  subtree: true,
});
