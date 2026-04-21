import ReactDOM from 'react-dom/client';
import App from './content/App';
import { useGameStore, toColor, type Color } from './content/stores/gameStore';
import { useSuggestionStore } from './content/stores/suggestionStore';
import { connectWs, disconnectWs } from './content/lib/websocket';
import { useAuthStore } from './content/stores/authStore';
import { useSettingsStore } from './content/stores/settingsStore';
import { renderArrows, clearArrows } from './content/lib/arrows';
import { initEvalBar } from './content/lib/evalBar';
import { AnalysisEngine } from './content/lib/analysisEngine';
import { SuggestionEngine } from './content/lib/suggestionEngine';
import { analyzeLastMove } from './content/lib/moveAnalysis';
import { useAnalysisStore } from './content/stores/analysisStore';
import { useExplanationStore } from './content/stores/explanationStore';
import { useEngineStore } from './content/stores/engineStore';
import { animationGate } from './content/stores/animationStore';
import { useEvalStore } from './content/stores/evalStore';
import { installHotkeyListener, installAutoPlayScheduler } from './content/lib/autoMoveScheduler';
let lastRequestedFen: string | null = null;
let analysisEngine: AnalysisEngine | null = null;
let suggestionEngine: SuggestionEngine | null = null;
let currentRequestId: string | null = null;
let previousFen: string | null = null;
let playerMoveCount = 0;

const SUGGESTION_DEBOUNCE_MS = 150;
let suggestionDebounce: ReturnType<typeof setTimeout> | null = null;

function parseMoveNumber(fen: string): number {
  const parts = fen.split(' ');
  return parseInt(parts[5] || '1', 10);
}

const FREE_DEFAULTS = { mode: 'nodes' as const, nodes: 1_000_000, depth: 20, movetime: 2000 };
const PREMIUM_PLANS = ['premium', 'lifetime', 'beta', 'freetrial'];

function isPremiumPlan(plan: string | undefined): boolean {
  return PREMIUM_PLANS.includes(plan ?? '');
}

function requestSuggestion(fen: string, force = false) {
  const hasUser = !!useAuthStore.getState().user;
  const engineReady = suggestionEngine?.ready ?? false;
  const dedup = !force && fen === lastRequestedFen;
  console.log('[Chessr][debug] requestSuggestion', { force, dedup, hasUser, engineReady, fen: fen.slice(0, 18) + '…' });

  if (!force && fen === lastRequestedFen) return;
  lastRequestedFen = fen;

  if (!hasUser) return;
  if (!engineReady) return;

  // Debounce: when moves come rapid-fire (game review, bot auto-move),
  // only the last position in the window triggers a real search.
  // `force` bypasses the debounce for one-shot catch-ups (init-complete
  // re-fire, chessr:rescan).
  if (suggestionDebounce) clearTimeout(suggestionDebounce);
  const delay = force ? 0 : SUGGESTION_DEBOUNCE_MS;
  suggestionDebounce = setTimeout(() => {
    suggestionDebounce = null;
    console.log('[Chessr][debug] debounce fired, calling runSuggestionSearch');
    runSuggestionSearch(fen);
  }, delay);
}

function runSuggestionSearch(fen: string) {
  if (!suggestionEngine?.ready) { console.log('[Chessr][debug] runSuggestionSearch bail: engine not ready'); return; }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentRequestId = requestId;
  useSuggestionStore.getState().setLoading(true, requestId);
  console.log('[Chessr][debug] engine.search start', requestId);

  const engine = useEngineStore.getState();
  const effectiveElo = engine.getEffectiveElo();
  const premium = isPremiumPlan(useAuthStore.getState().plan);

  // Free tier: force defaults + UCI_LimitStrength on, regardless of stored prefs
  // (user may have been premium previously and still has custom values).
  const limitStrength = premium ? engine.limitStrength : true;
  const search = premium
    ? { mode: engine.searchMode, nodes: engine.searchNodes, depth: engine.searchDepth, movetime: engine.searchMovetime }
    : FREE_DEFAULTS;

  suggestionEngine.search({
    fen,
    moves: [],
    targetElo: effectiveElo,
    personality: engine.personality,
    multiPv: useSettingsStore.getState().numArrows,
    limitStrength,
    // Auto mode: leave the option unset so Komodo uses its own default
    ...(engine.dynamismAuto ? {} : { dynamism: engine.dynamism }),
    ...(engine.kingSafetyAuto ? {} : { kingSafety: engine.kingSafety }),
    ...(engine.variety > 0 ? { variety: engine.variety } : {}),
    search,
  }).then((suggestions) => {
    console.log('[Chessr][debug] engine.search resolved', requestId, 'n=', suggestions.length);
    if (requestId !== currentRequestId) { console.log('[Chessr][debug] stale result, ignored'); return; }
    useSuggestionStore.getState().setSuggestions(suggestions, requestId);
    animationGate.markEvent('suggestions');
  }).catch((err) => {
    // Search got cancelled (newer request came in, or game ended). Silent.
    if (err?.name === 'AbortError') { console.log('[Chessr][debug] engine.search aborted', requestId); return; }
    console.error('[Chessr] suggestion error:', err);
    if (requestId === currentRequestId) useSuggestionStore.getState().setLoading(false, requestId);
  });
}

/** Reset all pending suggestion state — used on game end / new game. */
function resetSuggestionState(reason?: string) {
  console.log('[Chessr][debug] resetSuggestionState', reason ?? '');
  if (suggestionDebounce) { clearTimeout(suggestionDebounce); suggestionDebounce = null; }
  currentRequestId = null;
  lastRequestedFen = null;
  suggestionEngine?.cancel().catch(() => { /* already cancelled / not running */ });
  useSuggestionStore.getState().clear();
}

export default defineContentScript({
  matches: ['*://chess.com/*', '*://*.chess.com/*', '*://lichess.org/*', '*://*.lichess.org/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Init eval bar in page DOM (outside Shadow Root)
    initEvalBar();

    // Auto Move: install hotkey listener + auto-play scheduler
    installHotkeyListener();
    installAutoPlayScheduler();
    // Suggestions are now served by the local SuggestionEngine; no WS
    // message dispatch needed here.

    // Render arrows when suggestions change (with animation)
    useSuggestionStore.subscribe((state) => {
      if (state.suggestions.length > 0) {
        const isFlipped = useGameStore.getState().playerColor === 'black';
        renderArrows(state.suggestions, isFlipped, true);
      } else {
        clearArrows();
      }
    });

    // Re-render arrows on settings change (no animation) + re-request if numArrows changed
    useSettingsStore.subscribe((state, prev) => {
      const { suggestions } = useSuggestionStore.getState();
      if (suggestions.length > 0) {
        const isFlipped = useGameStore.getState().playerColor === 'black';
        renderArrows(suggestions, isFlipped, false);
      }

      if (state.numArrows !== prev.numArrows) {
        const { fen, isPlaying, playerColor, turn } = useGameStore.getState();
        if (isPlaying && fen && playerColor === turn) {
          requestSuggestion(fen, true);
        }
      }
    });

    // Re-request suggestions when engine settings change (debounced)
    let engineDebounce: ReturnType<typeof setTimeout> | null = null;
    // Only re-fire when a UCI-impacting setting actually changes. Filtering out
    // no-op mutations (e.g. setCapabilities after engine init, which updates
    // UI gating but doesn't alter the search params) avoids a spurious search
    // right after login.
    useEngineStore.subscribe((state, prev) => {
      const changed =
        state.targetEloAuto !== prev.targetEloAuto ||
        state.targetEloManual !== prev.targetEloManual ||
        state.autoEloBoost !== prev.autoEloBoost ||
        state.userElo !== prev.userElo ||
        state.opponentElo !== prev.opponentElo ||
        state.personality !== prev.personality ||
        state.dynamism !== prev.dynamism ||
        state.dynamismAuto !== prev.dynamismAuto ||
        state.kingSafety !== prev.kingSafety ||
        state.kingSafetyAuto !== prev.kingSafetyAuto ||
        state.variety !== prev.variety ||
        state.limitStrength !== prev.limitStrength ||
        state.searchMode !== prev.searchMode ||
        state.searchNodes !== prev.searchNodes ||
        state.searchDepth !== prev.searchDepth ||
        state.searchMovetime !== prev.searchMovetime;
      if (!changed) return;
      if (engineDebounce) clearTimeout(engineDebounce);
      engineDebounce = setTimeout(() => {
        const { fen, isPlaying, playerColor, turn } = useGameStore.getState();
        if (isPlaying && fen && playerColor === turn) {
          requestSuggestion(fen, true);
        }
      }, 300);
    });

    // Connect WS and load settings on login transition only (auth store fires on
    // every state change — plan fetch, session refresh — so we dedupe on userId).
    let lastLoggedInUserId: string | null = null;
    useAuthStore.subscribe((state) => {
      if (state.initializing) return;
      const uid = state.user?.id ?? null;
      if (uid && uid !== lastLoggedInUserId) {
        lastLoggedInUserId = uid;
        connectWs(uid);
        useSettingsStore.getState().loadFromCloud(uid);
        if (!analysisEngine) {
          const jsUrl = browser.runtime.getURL('/engine/stockfish.js');
          const wasmUrl = browser.runtime.getURL('/engine/stockfish.wasm');
          analysisEngine = new AnalysisEngine();
          analysisEngine.init(jsUrl, wasmUrl).catch((err) => {
            console.error('[Chessr] Failed to init analysis engine:', err);
            analysisEngine = null;
          });
        }
        if (!suggestionEngine) {
          const jsUrl = browser.runtime.getURL('/engine/dragon.js');
          const wasmUrl = browser.runtime.getURL('/engine/dragon.wasm');
          const bookUrl = browser.runtime.getURL('/engine/book.bin');
          suggestionEngine = new SuggestionEngine();
          suggestionEngine.init(jsUrl, wasmUrl, bookUrl).then(() => {
            const s = suggestionEngine!.supportedOptions;
            console.log('[Chessr] Dragon UCI options (' + s.size + '):', Array.from(s).sort());
            useEngineStore.getState().setCapabilities({
              hasPersonality: s.has('Personality'),
              hasUciElo: s.has('UCI Elo') || s.has('UCI_Elo'),
              hasDynamism: s.has('Dynamism'),
              hasKingSafety: s.has('King Safety'),
              hasVariety: s.has('Variety'),
            });
            // If a game is already in play when init completes, re-fire once.
            const { fen, isPlaying, playerColor, turn } = useGameStore.getState();
            if (isPlaying && fen && playerColor === turn) {
              requestSuggestion(fen, true);
            }
          }).catch((err) => {
            console.error('[Chessr] Failed to init suggestion engine:', err);
            suggestionEngine = null;
          });
        }
      }
      if (!uid && lastLoggedInUserId) {
        lastLoggedInUserId = null;
        disconnectWs();
        resetSuggestionState('logout');
        if (suggestionEngine) { suggestionEngine.destroy(); suggestionEngine = null; }
        if (analysisEngine) { analysisEngine.destroy(); analysisEngine = null; }
      }
    });

    // Request suggestions when it's the player's turn
    useGameStore.subscribe((state, prev) => {
      const { isPlaying, fen, playerColor, turn, gameOver } = state;

      // Clear on new game or game over — cancel in-flight search too so a
      // late response doesn't repopulate arrows after the game ended.
      if (!isPlaying || gameOver) {
        resetSuggestionState('game-over-or-not-playing');
        return;
      }

      if (!playerColor || !turn || !fen || playerColor !== turn) {
        clearArrows();
        resetSuggestionState('not-player-turn');
        return;
      }

      // Trigger when: position changed, turn switched to us, game just started, or player color resolved
      const positionChanged = fen !== prev.fen;
      const turnChanged = turn !== prev.turn;
      const gameJustStarted = isPlaying && !prev.isPlaying;
      const playerColorResolved = playerColor !== null && prev.playerColor === null;

      if (positionChanged || turnChanged || gameJustStarted || playerColorResolved) {
        requestSuggestion(fen);
      }
    });

    // Analyze player's last move when turn switches to opponent
    useGameStore.subscribe((state, prev) => {
      if (prev.fen && prev.fen !== state.fen) {
        previousFen = prev.fen;
      }

      // FEN side-to-move is ground truth — resilient to stale playerColor
      // early in the game (e.g. before `playingAs` stabilizes on SPA nav).
      const sideToMove = previousFen ? previousFen.split(' ')[1] : null;
      const playerChar = state.playerColor === 'white' ? 'w' : state.playerColor === 'black' ? 'b' : null;
      const playerJustMoved =
        previousFen !== null &&
        playerChar !== null &&
        sideToMove === playerChar &&
        previousFen !== state.fen &&
        state.isPlaying &&
        !state.gameOver;

      if (playerJustMoved && analysisEngine?.ready) {
        playerMoveCount++;
        const moveNumber = parseMoveNumber(previousFen!);
        const fenBefore = previousFen!;
        const fenAfter = state.fen!;

        useAnalysisStore.getState().setAnalyzing(true);
        analyzeLastMove(fenBefore, fenAfter, analysisEngine)
          .then((result) => {
            useAnalysisStore.getState().addAnalysis({ ...result, moveNumber });
            animationGate.markEvent('analysis');
            // Update eval bar — evalAfter is player POV, convert to white's
            const pc = useGameStore.getState().playerColor;
            const evalWhite = pc === 'black' ? -result.evalAfter : result.evalAfter;
            useEvalStore.getState().setEval(evalWhite);
          })
          .catch((err) => {
            console.error('[Chessr] Analysis error:', err);
          })
          .finally(() => {
            useAnalysisStore.getState().setAnalyzing(false);
          });
      }

      // Opponent just moved — quick eval for the eval bar
      const fenSideToMove = state.fen ? state.fen.split(' ')[1] : null;
      const opponentJustMoved =
        previousFen !== null &&
        previousFen !== state.fen &&
        playerChar !== null &&
        fenSideToMove === playerChar &&
        state.isPlaying &&
        !state.gameOver &&
        !!state.fen;

      if (opponentJustMoved && analysisEngine?.ready) {
        // Single position eval — just analyze the current FEN
        analysisEngine.analyze(state.fen!).then((result) => {
          // result.evaluation is side-to-move (player's) perspective in centipawns
          const pc = useGameStore.getState().playerColor;
          const evalWhite = pc === 'black' ? -result.evaluation / 100 : result.evaluation / 100;
          useEvalStore.getState().setEval(evalWhite);
        }).catch(() => {}); // silent fail
      }
    });

    // Listen for events from pageContext (MAIN world)
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (typeof data?.type !== 'string' || !data.type.startsWith('chessr:')) return;

      console.log(`[Chessr] ${data.type}`, data);

      const { setPlaying, setMove, setPlayerColor, reset } = useGameStore.getState();

      switch (data.type) {
        case 'chessr:mode': {
          const isGameMode = data.name === 'playing';
          const currentlyPlaying = useGameStore.getState().isPlaying;
          // Only set playing to true, never back to false from mode changes
          // (game end is handled by gameOver flag, new game by chessr:newGame)
          if (isGameMode && !currentlyPlaying) setPlaying(true);
          if (data.playingAs) setPlayerColor(toColor(data.playingAs));
          // While actually playing, chess.com's getPositionInfo / getResult may
          // briefly return stale game-over state (carried over from the previous
          // game reusing the same object). Trust `name === 'playing'` as ground
          // truth and ignore stale game-over flags.
          const gameOver = isGameMode ? false : (data.gameOver ?? false);
          const gameEnd = isGameMode ? null : data.gameEnd;
          if (data.fen) setMove(data.fen, gameOver, toColor(data.turn) as Color, gameEnd);
          if (!isGameMode && data.result && data.result !== '*') {
            useGameStore.getState().setGameOver(data.result);
          }
          break;
        }
        case 'chessr:move':
          if (data.fen) setMove(data.fen, data.gameOver, toColor(data.turn) as Color, data.gameEnd);
          break;
        case 'chessr:gameOver':
          // Server-side game end (resign, timeout, abandon, etc.)
          if (data.result && data.result !== '*') {
            useGameStore.getState().setGameOver(data.result);
          }
          break;
        case 'chessr:newGame':
          reset();
          resetSuggestionState('chessr:newGame');
          suggestionEngine?.newGame().catch(() => { /* engine gone */ });
          useAnalysisStore.getState().reset();
          useExplanationStore.getState().clear();
          useEvalStore.getState().reset();
          previousFen = null;
          playerMoveCount = 0;
          break;
        case 'chessr:ratings':
          if (data.playerRating) useEngineStore.getState().setUserElo(data.playerRating);
          if (data.opponentRating) useEngineStore.getState().setOpponentElo(data.opponentRating);
          break;
      }
    });

    // Request initial state from pageContext (handles case where pageContext loaded first)
    window.postMessage({ type: 'chessr:requestState' }, '*');

    // Debug: force a full rescan on demand (re-sync pageContext state + re-request suggestions)
    window.addEventListener('chessr:rescan', () => {
      console.log('[Chessr] rescan triggered');
      window.postMessage({ type: 'chessr:requestState' }, '*');
      const gs = useGameStore.getState();
      const user = useAuthStore.getState().user;
      console.log('[Chessr][debug] gameStore:', {
        isPlaying: gs.isPlaying, gameOver: gs.gameOver, fen: gs.fen, playerColor: gs.playerColor, turn: gs.turn,
        engineReady: suggestionEngine?.ready, hasUser: !!user, lastRequestedFen,
      });
      const { fen, isPlaying, playerColor, turn, gameOver } = gs;
      if (isPlaying && !gameOver && fen && playerColor === turn) {
        lastRequestedFen = null;
        requestSuggestion(fen, true);
      } else {
        console.log('[Chessr][debug] rescan bail: not in a player-turn state');
      }
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'chessr-app',
      position: 'overlay',
      zIndex: 2147483647,
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
