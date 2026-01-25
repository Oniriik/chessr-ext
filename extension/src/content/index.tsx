import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../presentation/App';
import { useAppStore } from '../presentation/store/app.store';
import { useOpeningStore } from '../presentation/store/opening.store';
import { createPlatformAdapter, PlatformAdapter } from './platforms';
import { MoveTracker } from './move-tracker';
import { WebSocketClient } from './websocket-client';
import { OverlayManager } from './overlay/overlay-manager';
import { ArrowRenderer } from './overlay/arrow-renderer';
import { EvalBar } from './overlay/eval-bar';
import { OpeningTracker } from './openings/opening-tracker';
import { AnalysisResult, BoardConfig, Settings } from '../shared/types';
import { isUpdateRequired } from '../shared/version';

// Convert WebSocket URL to HTTP URL for version endpoint
function getHttpVersionUrl(wsUrl: string): string {
  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  // Use port 3001 for HTTP endpoints (metrics server)
  const url = new URL(httpUrl);
  url.port = '3001';
  url.pathname = '/version';
  return url.toString();
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
  private currentEloOffset = 0;  // Anti-cheat: random offset ±100
  private versionCheckPassed = false;

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
      if (message.type === 'result') {
        this.onAnalysisResult(message as AnalysisResult);
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

    // Generate random ELO offset for anti-cheat (new game = new offset)
    if (store.settings.eloRandomization) {
      this.currentEloOffset = Math.floor(Math.random() * 201) - 100;  // -100 to +100
    } else {
      this.currentEloOffset = 0;
    }
    store.setEloOffset(this.currentEloOffset);

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
    this.moveTracker.onMoveDetected((move) => this.onMoveDetected(move));
  }

  private onMoveDetected(move: string) {
    // Forward move to opening tracker
    this.openingTracker.onMove(move);
  }


  private onPositionChange(fen: string) {
    const store = useAppStore.getState();
    const { settings, boardConfig } = store;
    if (!settings.enabled) return;
    if (!this.wsClient?.getConnectionStatus()) return;

    // Use boardConfig from store (can be updated by user via UI)
    const currentBoardConfig = boardConfig || this.boardConfig;
    if (!currentBoardConfig) return;

    const sideToMove = fen.split(' ')[1] as 'w' | 'b';
    const playerColor = currentBoardConfig.playerColor === 'white' ? 'w' : 'b';

    // Only analyze when it's the player's turn
    if (sideToMove !== playerColor) {
      this.overlay.clearArrows();
      store.setAnalysis(null);
      return;
    }

    const effectiveElo = settings.eloRandomization
      ? settings.targetElo + this.currentEloOffset
      : settings.targetElo;
    this.wsClient.analyze(fen, settings, effectiveElo);
  }

  private onAnalysisResult(result: AnalysisResult) {
    console.log('[Chessr] Analysis result received:', result);
    // Ignore empty results (cancelled analyses)
    if (!result.bestMove) {
      console.log('[Chessr] Ignoring empty result (no bestMove)');
      return;
    }

    const store = useAppStore.getState();
    store.setAnalysis(result);

    if (store.settings.showArrows) {
      const linesToDraw = result.lines.slice(0, store.settings.numberOfSuggestions);
      console.log('[Chessr] Drawing arrows for', linesToDraw.length, 'lines');
      this.arrowRenderer.drawBestMoves(linesToDraw, {
        useDifferentColors: store.settings.useDifferentArrowColors,
        colors: store.settings.arrowColors,
        singleColor: store.settings.singleArrowColor,
      });
    }

    if (store.settings.showEvalBar) {
      console.log('[Chessr] Updating eval bar:', result.evaluation);
      this.evalBar.update(result.evaluation, result.mate);
    }
  }

  private onSettingsChanged(settings: Settings, prevSettings: Settings) {
    // Update WebSocket client if URL changed
    if (this.wsClient && settings.serverUrl !== this.wsClient['serverUrl']) {
      this.wsClient.disconnect();
      this.wsClient = new WebSocketClient(settings.serverUrl);
      this.wsClient.onMessage((message) => {
        if (message.type === 'result') {
          this.onAnalysisResult(message as AnalysisResult);
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
      settings.mode !== prevSettings.mode ||
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
