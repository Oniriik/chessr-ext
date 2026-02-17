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
import {
  SuggestionMove,
  SuggestionResult,
  SuggestionError,
  AnalysisNewResult,
  AnalysisNewError,
} from '../domain/analysis/feedback-types';
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

  // Suggestion tracking (one at a time, anti-stale)
  private lastSuggestionRequestId: string | null = null;

  // Analysis tracking (multiple allowed, Set for anti-stale)
  private pendingAnalysisRequests = new Set<string>();
  private lastFenBeforeMove: string | null = null;

  // New game detection
  private lastMoveHistoryLength = 0;
  private lastFirstMove: string | null = null;

  // Rating detection tracking
  private initialRatingDetectionDone = false;
  private pendingPositionForAnalysis: string | null = null;

  async init() {
    // Reset rating detection flag for new page load
    this.initialRatingDetectionDone = false;
    this.pendingPositionForAnalysis = null;

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

        // Re-detect ratings when auto-detect is toggled on (no delay for manual toggle)
        if (!prevState.settings.autoDetectTargetElo && state.settings.autoDetectTargetElo) {
          this.autoDetectRatingsIfNeeded(0);
        }
      }
      // Re-analyze when player color changes (via toggle or redetect)
      if (state.boardConfig?.playerColor !== prevState.boardConfig?.playerColor) {
        // Update move tracker with new player color
        if (state.boardConfig?.playerColor) {
          this.moveTracker.setPlayerColor(state.boardConfig.playerColor);
        }
        // Update overlay and eval bar with new isFlipped value
        if (state.boardConfig) {
          const newIsFlipped = state.boardConfig.playerColor === 'black';
          this.overlay.setFlipped(newIsFlipped);
          this.evalBar.setFlipped(newIsFlipped);
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
      if (message.type === 'suggestion_result') {
        this.onSuggestionResult(message);
      } else if (message.type === 'suggestion_error') {
        this.onSuggestionError(message);
      } else if (message.type === 'analysis_result') {
        this.onAnalysisResult(message);
      } else if (message.type === 'analysis_error') {
        this.onAnalysisError(message);
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

    // Auto-detect ratings if enabled
    this.autoDetectRatingsIfNeeded();

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
      this.evalBar.setFlipped(config.playerColor === 'black');
    }

    // Register callbacks BEFORE starting (so initial position is captured)
    this.moveTracker.onPositionChange((fen) => this.onPositionChange(fen));
    this.moveTracker.onMoveDetected((move) => {
      this.onMoveDetected(move);
      // Forward to feedback store
      const feedbackStore = useFeedbackStore.getState();
      feedbackStore.handlePlayerMove(move);
    });

    // Start tracking moves with player color
    this.moveTracker.start(config.boardElement, config.playerColor);
  }

  private onMoveDetected(move: string) {
    // Forward move to opening tracker
    this.openingTracker.onMove(move);

    // Send analysis request if we have the FEN before the move
    if (this.lastFenBeforeMove && this.wsClient?.getConnectionStatus()) {
      const store = useAppStore.getState();
      const { settings, boardConfig } = store;

      if (!settings.enabled || !boardConfig) {
        return;
      }

      const fenAfter = this.moveTracker.getCurrentFEN();
      const moveHistory = this.adapter?.getMoveHistory?.() || [];
      const playerColor = boardConfig.playerColor === 'white' ? 'w' : 'b';

      // Validate that the fenBefore is for the player's turn
      // This prevents analyzing opponent's moves with wrong FEN
      const fenBeforeSide = this.lastFenBeforeMove.split(' ')[1] as 'w' | 'b';
      if (fenBeforeSide !== playerColor) {
        console.log('[Chessr] Skipping analysis - fenBefore is for opponent turn:', {
          move,
          fenBeforeSide,
          playerColor,
        });
        // Don't clear lastFenBeforeMove - it's still valid for the player's next move
        return;
      }

      // IMPORTANT: moveHistory already includes the just-played move (from DOM)
      // For analysis, we need the history BEFORE the move was played
      // Server will add the move back when analyzing fenAfter: [...movesBeforeMove, move]
      const movesBeforeMove = moveHistory.slice(0, -1);

      // Send analysis request
      const requestId = generateShortRequestId();
      this.pendingAnalysisRequests.add(requestId);

      // DEBUG: Log FEN details
      const fenAfterSide = fenAfter.split(' ')[1];
      console.log('[Chessr] Sending analysis:', {
        move,
        requestId,
        fenBeforeSide,  // Should match who played (w if White played)
        fenAfterSide,   // Should be opposite of fenBeforeSide
        playerColor,
        'boardConfig.playerColor': boardConfig.playerColor,
        movesBeforeCount: movesBeforeMove.length,
      });

      this.wsClient.analyzeNew(
        this.lastFenBeforeMove,
        fenAfter,
        move,
        movesBeforeMove,
        playerColor,
        settings.targetElo,
        requestId
      );

      // Clear lastFenBeforeMove to prevent duplicate analysis
      this.lastFenBeforeMove = null;
    }
  }

  /**
   * Auto-detect ratings from the page if enabled in settings
   * @param delay - Optional delay in ms before detection (default: 2000 for initial load, 0 for manual toggle)
   */
  private autoDetectRatingsIfNeeded(delay: number = 2000) {
    const store = useAppStore.getState();
    const { settings } = store;

    // Check if adapter supports rating detection
    if (!this.adapter?.detectRatings) {
      this.initialRatingDetectionDone = true;
      return;
    }

    // Only auto-detect if enabled
    if (!settings.autoDetectTargetElo) {
      this.initialRatingDetectionDone = true;
      return;
    }

    // Wait for DOM elements to load (ratings appear after board on initial load)
    setTimeout(() => {
      const ratings = this.adapter!.detectRatings!();

      const updates: Partial<Settings> = {};

      // Update user ELO and target ELO if auto-detect is enabled and rating is found
      if (settings.autoDetectTargetElo && ratings.playerRating) {
        updates.userElo = ratings.playerRating;
        updates.targetElo = ratings.playerRating + 150;  // Target = User ELO + 150
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        store.setSettings(updates);
      }

      // Mark initial detection as done
      this.initialRatingDetectionDone = true;

      // If there was a pending position, analyze it now
      if (this.pendingPositionForAnalysis) {
        const fen = this.pendingPositionForAnalysis;
        this.pendingPositionForAnalysis = null;
        this.onPositionChange(fen);
      }
    }, delay);
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

    // Wait for initial rating detection before first analysis
    if (!this.initialRatingDetectionDone && settings.autoDetectTargetElo) {
      this.pendingPositionForAnalysis = fen;
      return;
    }

    // Use boardConfig from store (can be updated by user via UI)
    const currentBoardConfig = boardConfig || this.boardConfig;
    if (!currentBoardConfig) {
      return;
    }

    const playerColor = currentBoardConfig.playerColor === 'white' ? 'w' : 'b';
    const moveHistory = this.adapter?.getMoveHistory?.() || [];

    console.log('[Chessr] Position change - Player:', currentBoardConfig.playerColor, '(' + playerColor + ')', 'Side to move:', sideToMove, 'Moves:', moveHistory.length);

    // Detect new game (reset accumulated stats)
    const currentFirstMove = moveHistory.length > 0 ? moveHistory[0] : null;
    const isNewGame =
      (moveHistory.length < this.lastMoveHistoryLength) || // Move count decreased
      (currentFirstMove !== null && currentFirstMove !== this.lastFirstMove); // Different opening

    if (isNewGame && this.lastMoveHistoryLength > 0) {
      console.log('[Chessr] 🎮 New game detected - resetting stats');
      const feedbackStore = useFeedbackStore.getState();
      feedbackStore.reset();
      feedbackStore.resetNewAccuracy();
      this.openingTracker.reset();
      this.lastSuggestionRequestId = null;
      this.pendingAnalysisRequests.clear();
      this.lastFenBeforeMove = null;
    }

    // Update tracking for next detection
    this.lastMoveHistoryLength = moveHistory.length;
    this.lastFirstMove = currentFirstMove;

    // Opponent's turn → Clear arrows, no suggestions
    if (sideToMove !== playerColor) {
      console.log('[Chessr] Opponent turn - clearing UI');
      this.overlay.clearArrows();
      store.setAnalysis(null);
      this.lastSuggestionRequestId = null;
      return;
    }

    // Player's turn → Capture FEN before move and request suggestions
    const currentFen = this.moveTracker.getCurrentFEN();
    this.lastFenBeforeMove = currentFen; // Save for analysis when player moves

    // Skip if playing Black and no moves yet (waiting for White's first move)
    if (playerColor === 'b' && moveHistory.length === 0) {
      console.log('[Chessr] Skipping - waiting for White first move');
      return;
    }

    console.log('[Chessr] Player turn - requesting suggestions', {
      fen: currentFen,
      movesCount: moveHistory.length,
      targetElo: settings.targetElo,
      personality: settings.personality,
      multiPV: settings.multiPV,
      riskTaking: settings.riskTaking,
    });
    const requestId = generateShortRequestId();
    this.lastSuggestionRequestId = requestId;

    this.wsClient.suggestion(currentFen, moveHistory, settings, requestId);
  }

  /**
   * Handler for suggestion results.
   * Updates UI with move suggestions and arrows.
   */
  private onSuggestionResult(result: SuggestionResult) {
    console.log('[Chessr] Suggestion result received', result.requestId);

    // Anti-stale: ignore if not the latest suggestion request
    if (result.requestId !== this.lastSuggestionRequestId) {
      console.log('[Chessr] Stale suggestion result ignored');
      return;
    }

    // Get current position info
    const currentFen = this.moveTracker.getCurrentFEN();
    const moveHistory = this.adapter?.getMoveHistory?.() || [];

    // Update feedback store
    const feedbackStore = useFeedbackStore.getState();
    feedbackStore.handleNewSuggestionResult(result, currentFen, moveHistory);

    // Update arrows if enabled
    const store = useAppStore.getState();
    if (store.settings.showArrows && result.suggestions.length > 0) {
      this.updateArrowsFromSuggestions(result.suggestions);
    }

    // Update eval bar from suggestion data (either positionEval or mateIn must be defined)
    const hasEvalData = result.positionEval !== undefined || result.mateIn !== undefined;
    if (store.settings.showEvalBar && this.evalBar && hasEvalData) {
      const sideToMove = currentFen.split(' ')[1] as 'w' | 'b';

      // positionEval is in centipawns from side-to-move perspective
      // Convert to White POV for consistent handling
      const evalWhitePov = result.positionEval !== undefined
        ? (sideToMove === 'w' ? result.positionEval : -result.positionEval)
        : 0;
      const evalInPawns = evalWhitePov / 100;

      // mateIn is already in White POV from the server (no conversion needed)
      const mateInWhitePov = result.mateIn;

      // winRate is from side-to-move perspective, convert to White POV
      const winRateSideToMove = result.winRate ?? 50;
      const winRate = sideToMove === 'w' ? winRateSideToMove : (100 - winRateSideToMove);

      console.log('[Chessr] Eval bar update from suggestion:', {
        positionEval: result.positionEval,
        evalWhitePov,
        evalInPawns,
        mateIn: result.mateIn,
        mateInWhitePov,
        winRate,
        mode: store.settings.evalBarMode,
      });

      this.evalBar.update(evalInPawns, mateInWhitePov, store.settings.evalBarMode, winRate);
    }
  }

  /**
   * Handler for suggestion errors.
   */
  private onSuggestionError(error: SuggestionError) {
    console.error('[Chessr] Suggestion error:', error.error);
    const feedbackStore = useFeedbackStore.getState();
    feedbackStore.handleNewSuggestionError(error);
  }

  /**
   * Handler for analysis results (move accuracy).
   */
  private onAnalysisResult(result: AnalysisNewResult) {
    console.log('[Chessr] Analysis result received', result.requestId, result.classification);

    // Anti-stale: ignore if not a pending request
    if (!this.pendingAnalysisRequests.has(result.requestId)) {
      console.log('[Chessr] Stale analysis result ignored');
      return;
    }

    // Remove from pending set
    this.pendingAnalysisRequests.delete(result.requestId);

    // Update feedback store with analysis
    const feedbackStore = useFeedbackStore.getState();
    feedbackStore.handleNewAnalysisResult(result);

    // Note: Eval bar is now updated from suggestion results (onSuggestionResult)
    // Analysis results are used for accuracy tracking only
  }

  /**
   * Handler for analysis errors.
   */
  private onAnalysisError(error: AnalysisNewError) {
    console.error('[Chessr] Analysis error:', error.error);

    // Remove from pending set if present
    if (error.requestId) {
      this.pendingAnalysisRequests.delete(error.requestId);
    }

    const feedbackStore = useFeedbackStore.getState();
    feedbackStore.handleNewAnalysisError(error);
  }

  private updateArrowsFromSuggestions(suggestions: SuggestionMove[]) {
    const store = useAppStore.getState();
    this.overlay.clearArrows();

    // Draw arrows for suggestions based on settings
    const numToShow = Math.min(suggestions.length, store.settings.numberOfSuggestions);

    // Calculate arrow length (in squares) for sorting
    const getArrowLength = (from: string, to: string): number => {
      const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
      const rankDiff = Math.abs(parseInt(from[1]) - parseInt(to[1]));
      return Math.sqrt(fileDiff * fileDiff + rankDiff * rankDiff);
    };

    // Build arrow data with length for sorting
    const arrowData: { from: string; to: string; color: string; badges: string[]; length: number }[] = [];

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
            badge.startsWith('Mate') || // Mate
            badge === 'Check' ||        // Check
            badge.startsWith('x ') ||   // Capture
            badge.includes('Promo');    // Promotion

          return (showQualityLabels && isQualityBadge) || (showEffectLabels && isEffectBadge);
        });
      }

      arrowData.push({ from, to, color, badges, length: getArrowLength(from, to) });
    }

    // Sort by length descending (longest first, so shortest appears on top)
    arrowData.sort((a, b) => b.length - a.length);

    // Draw arrows in sorted order
    for (const arrow of arrowData) {
      this.arrowRenderer['drawArrowWithColor']({
        from: arrow.from,
        to: arrow.to,
        color: arrow.color,
        badges: arrow.badges
      });
    }
  }

  private onSettingsChanged(settings: Settings, prevSettings: Settings) {
    // Update WebSocket client if URL changed
    if (this.wsClient && settings.serverUrl !== this.wsClient['serverUrl']) {
      this.wsClient.disconnect();
      this.wsClient = new WebSocketClient(settings.serverUrl);
      this.wsClient.onMessage((message) => {
        if (message.type === 'suggestion_result') {
          this.onSuggestionResult(message);
        } else if (message.type === 'suggestion_error') {
          this.onSuggestionError(message);
        } else if (message.type === 'analysis_result') {
          this.onAnalysisResult(message);
        } else if (message.type === 'analysis_error') {
          this.onAnalysisError(message);
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
      settings.riskTaking !== prevSettings.riskTaking ||
      settings.moveTime !== prevSettings.moveTime ||
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
