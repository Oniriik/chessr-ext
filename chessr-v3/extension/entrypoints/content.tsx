import ReactDOM from 'react-dom/client';
import App from './content/App';
import { useGameStore, toColor, type Color } from './content/stores/gameStore';
import { useSuggestionStore } from './content/stores/suggestionStore';
import { connectWs, disconnectWs, sendWs } from './content/lib/websocket';
import { useAuthStore } from './content/stores/authStore';
import { useSettingsStore } from './content/stores/settingsStore';
import { renderArrows, clearArrows } from './content/lib/arrows';
import { installArrowDrag } from './content/lib/dragArrows';
import { initEvalBar } from './content/lib/evalBar';
import { AnalysisEngine } from './content/lib/analysisEngine';
import { SuggestionEngine } from './content/lib/suggestionEngine';
import { MaiaSuggestionEngine } from './content/lib/maiaSuggestionEngine';
import { PatriciaSuggestionEngine } from './content/lib/patriciaSuggestionEngine';
import type { IEngine, SuggestionSearchParams as EngineSearchParams } from './content/lib/engineApi';
import type { EngineId } from './content/stores/engineStore';
import { analyzeLastMove } from './content/lib/moveAnalysis';
import { useAnalysisStore } from './content/stores/analysisStore';
import { useExplanationStore } from './content/stores/explanationStore';
import { useEngineStore } from './content/stores/engineStore';
import { animationGate } from './content/stores/animationStore';
import { useEvalStore } from './content/stores/evalStore';
import { installHotkeyListener, installAutoPlayScheduler } from './content/lib/autoMoveScheduler';
let lastRequestedFen: string | null = null;
let analysisEngine: AnalysisEngine | null = null;
let suggestionEngine: IEngine | null = null;
let suggestionEngineSwapInFlight: Promise<void> | null = null;
let currentRequestId: string | null = null;
let previousFen: string | null = null;
let playerMoveCount = 0;

const SUGGESTION_DEBOUNCE_MS = 150;
let suggestionDebounce: ReturnType<typeof setTimeout> | null = null;
// Key of the last successfully-issued search (fen + full option snapshot).
// Lets us skip firing a redundant search when multiple stores fan out
// "something changed" notifications that don't actually affect the query.
let lastSearchKey: string | null = null;

// Deferred handler for chess.com's sometimes-spurious chessr:newGame. See
// the message handler below.
let newGameResetTimer: ReturnType<typeof setTimeout> | null = null;
let pendingNewGameFen: string | null = null;

function parseMoveNumber(fen: string): number {
  const parts = fen.split(' ');
  return parseInt(parts[5] || '1', 10);
}

const FREE_DEFAULTS = { mode: 'nodes' as const, nodes: 1_000_000, depth: 20, movetime: 2000 };
const PREMIUM_PLANS = ['premium', 'lifetime', 'beta', 'freetrial'];

function isPremiumPlan(plan: string | undefined): boolean {
  return PREMIUM_PLANS.includes(plan ?? '');
}

async function createEngine(id: EngineId): Promise<IEngine> {
  let eng: IEngine;
  switch (id) {
    case 'maia2':    eng = new MaiaSuggestionEngine(); break;
    case 'patricia': eng = new PatriciaSuggestionEngine(); break;
    default:         eng = new SuggestionEngine(); break; // 'komodo'
  }
  await eng.init();
  return eng;
}

/**
 * Replace the current suggestion engine with one for the given id.
 * Cancels any in-flight search, destroys the old instance, then constructs
 * and inits the new one. Re-fires a suggestion request if a game is live.
 *
 * Serialised via `suggestionEngineSwapInFlight` so rapid-fire engine toggles
 * don't race two inits in parallel.
 */
function swapSuggestionEngine(id: EngineId): Promise<void> {
  const swap = (suggestionEngineSwapInFlight ?? Promise.resolve()).then(async () => {
    if (suggestionEngine?.id === id && suggestionEngine.ready) return;

    if (suggestionEngine) {
      try { await suggestionEngine.cancel(); } catch { /* ignore */ }
      suggestionEngine.destroy();
      suggestionEngine = null;
    }

    const fresh = await createEngine(id);
    suggestionEngine = fresh;
    useEngineStore.getState().setCapabilities(fresh.getCapabilities());
    console.log(`[Chessr] suggestion engine ready: ${id}`);

    // Re-fire if a game is live and waiting for our move.
    const { fen, isPlaying, playerColor, turn } = useGameStore.getState();
    if (isPlaying && fen && playerColor === turn) {
      requestSuggestion(fen, true);
    }
  });
  suggestionEngineSwapInFlight = swap;
  return swap;
}

function requestSuggestion(fen: string, force = false) {
  if (!force && fen === lastRequestedFen) return;
  lastRequestedFen = fen;

  if (!useAuthStore.getState().user) return;
  if (!suggestionEngine?.ready) return;

  // Debounce: when moves come rapid-fire (game review, bot auto-move),
  // only the last position in the window triggers a real search.
  // `force` bypasses the debounce for one-shot catch-ups (init-complete
  // re-fire, chessr:rescan).
  if (suggestionDebounce) clearTimeout(suggestionDebounce);
  const delay = force ? 0 : SUGGESTION_DEBOUNCE_MS;
  suggestionDebounce = setTimeout(() => {
    suggestionDebounce = null;
    runSuggestionSearch(fen);
  }, delay);
}

function runSuggestionSearch(fen: string) {
  if (!suggestionEngine?.ready) return;

  const engine = useEngineStore.getState();
  const premium = isPremiumPlan(useAuthStore.getState().plan);
  const numArrows = useSettingsStore.getState().numArrows;

  let params: EngineSearchParams;
  if (suggestionEngine.id === 'maia2') {
    params = {
      fen,
      moves: [] as string[],
      multiPv: numArrows,
      eloSelf: engine.getMaiaEffectiveTargetElo(),
      eloOppo: engine.getMaiaEffectiveOppoElo(),
      variant: engine.maiaVariant,
      useBook: engine.maiaUseBook,
    };
  } else if (suggestionEngine.id === 'patricia') {
    // Patricia shares the classical-engine knobs (targetElo, limitStrength,
    // search budget) but doesn't accept personality/dynamism/kingsafety/variety.
    // NOTE: Patricia is single-threaded synchronous WASM. Deep depth budgets
    // (e.g. depth ≥ 18) carried over from Komodo settings can take 5s+ per
    // move, which freezes the suggestion UI (no streaming `info` lines). The
    // user should keep depth ≤ 14 or use movetime/nodes mode for snappy UX.
    const effectiveElo = engine.getEffectiveElo();
    const limitStrength = premium ? engine.limitStrength : true;
    const search = premium
      ? { mode: engine.searchMode, nodes: engine.searchNodes, depth: engine.searchDepth, movetime: engine.searchMovetime }
      : FREE_DEFAULTS;
    params = {
      fen,
      moves: [] as string[],
      targetElo: effectiveElo,
      multiPv: numArrows,
      limitStrength,
      search,
    };
  } else {
    const effectiveElo = engine.getEffectiveElo();
    // Free tier: force defaults + UCI_LimitStrength on, regardless of stored prefs
    // (user may have been premium previously and still has custom values).
    const limitStrength = premium ? engine.limitStrength : true;
    const search = premium
      ? { mode: engine.searchMode, nodes: engine.searchNodes, depth: engine.searchDepth, movetime: engine.searchMovetime }
      : FREE_DEFAULTS;
    params = {
      fen,
      moves: [] as string[],
      targetElo: effectiveElo,
      personality: engine.personality,
      multiPv: numArrows,
      limitStrength,
      ...(engine.dynamismAuto ? {} : { dynamism: engine.dynamism }),
      ...(engine.kingSafetyAuto ? {} : { kingSafety: engine.kingSafety }),
      ...(engine.variety > 0 ? { variety: engine.variety } : {}),
      search,
    };
  }

  // Dedup: if nothing about the query has actually changed since the last
  // search, multiple stores fanning out "maybe you want to re-search" events
  // shouldn't re-hit the engine — especially important with UCI_LimitStrength
  // which intentionally injects move-variance and would flicker different
  // arrows for identical inputs.
  const key = JSON.stringify(params);
  if (key === lastSearchKey) {
    console.log('[Chessr][dbg] search skipped (same params as last)');
    return;
  }
  lastSearchKey = key;

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentRequestId = requestId;
  useSuggestionStore.getState().setLoading(true, requestId);
  console.log('[Chessr][dbg] search start', { rid: requestId, multiPv: params.multiPv, fen: fen.slice(0, 22) + '…' });

  // Telemetry: log the search on the server (same format as the old
  // server-side engine) — compute is now local but we still want the audit
  // trail for stats / debugging / per-user rate analysis.
  const engineLabel = suggestionEngine.id;
  const extra = (() => {
    if (engineLabel === 'maia2') {
      return `engine=maia2 variant=${params.variant} eloSelf=${params.eloSelf} eloOppo=${params.eloOppo} mpv=${params.multiPv}`;
    }
    const searchDesc = params.search
      ? `${params.search.mode}:${
          params.search.mode === 'depth' ? params.search.depth
          : params.search.mode === 'nodes' ? params.search.nodes
          : params.search.mode === 'movetime' ? params.search.movetime
          : '?'
        }`
      : 'default';
    if (engineLabel === 'patricia') {
      return `engine=patricia elo=${params.targetElo} mpv=${params.multiPv} limit=${params.limitStrength} search=${searchDesc}`;
    }
    return `engine=komodo elo=${params.targetElo} mpv=${params.multiPv} limit=${params.limitStrength} perso=${params.personality} search=${searchDesc}`;
  })();
  sendWs({
    type: 'suggestion_log_start',
    requestId,
    extra,
  });

  suggestionEngine.search(params).then((suggestions) => {
    console.log('[Chessr][dbg] search resolved', {
      rid: requestId, n: suggestions.length,
      moves: suggestions.map((s) => s.move),
      depths: suggestions.map((s) => s.depth),
      stale: requestId !== currentRequestId,
    });
    if (requestId !== currentRequestId) return;
    useSuggestionStore.getState().setSuggestions(suggestions, requestId);
    animationGate.markEvent('suggestions');
    const topDepth = suggestions[0]?.depth ?? 0;
    sendWs({
      type: 'suggestion_log_end',
      requestId,
      extra: `d${topDepth} n=${suggestions.length}`,
    });
  }).catch((err) => {
    // Search got cancelled (newer request came in, or game ended). Silent.
    if (err?.name === 'AbortError') {
      console.log('[Chessr][dbg] search aborted', requestId);
      sendWs({ type: 'suggestion_log_end', requestId, extra: 'aborted' });
      return;
    }
    console.error('[Chessr] suggestion error:', err);
    if (requestId === currentRequestId) useSuggestionStore.getState().setLoading(false, requestId);
    sendWs({
      type: 'suggestion_log_end',
      requestId,
      extra: `fail:${err?.message || 'unknown'}`,
    });
  });
}

/** Reset all pending suggestion state — used on game end / new game. */
function resetSuggestionState() {
  if (suggestionDebounce) { clearTimeout(suggestionDebounce); suggestionDebounce = null; }
  currentRequestId = null;
  lastRequestedFen = null;
  lastSearchKey = null;
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
    // Shrink suggestion arrows in real time when the user grabs a matching piece.
    installArrowDrag();
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
        if (!analysisEngine) {
          const jsUrl = browser.runtime.getURL('/engine/stockfish.js');
          const wasmUrl = browser.runtime.getURL('/engine/stockfish.wasm');
          analysisEngine = new AnalysisEngine();
          analysisEngine.init(jsUrl, wasmUrl).catch((err) => {
            console.error('[Chessr] Failed to init analysis engine:', err);
            analysisEngine = null;
          });
        }
        // Wait for cloud settings before instantiating the suggestion engine —
        // otherwise we'd boot Komodo by default and immediately swap if the
        // user's cloud preference is Maia 2 (wasted ~1s of init + 16 MB load).
        useSettingsStore.getState().loadFromCloud(uid).then(() => {
          if (!suggestionEngine) {
            const targetEngine = useEngineStore.getState().engineId;
            swapSuggestionEngine(targetEngine).catch((err) => {
              console.error('[Chessr] Failed to init suggestion engine:', err);
            });
          }
        });
      }
      if (!uid && lastLoggedInUserId) {
        lastLoggedInUserId = null;
        disconnectWs();
        resetSuggestionState();
        if (suggestionEngine) { suggestionEngine.destroy(); suggestionEngine = null; }
        if (analysisEngine) { analysisEngine.destroy(); analysisEngine = null; }
      }
    });

    // Engine switch — when the user picks a different engine in Settings,
    // tear down the current one and bring up the chosen engine. Only acts
    // once the user is logged in (suggestionEngine non-null) so we don't
    // download Maia weights speculatively.
    let lastEngineId: EngineId = useEngineStore.getState().engineId;
    useEngineStore.subscribe((state) => {
      if (state.engineId === lastEngineId) return;
      lastEngineId = state.engineId;
      if (!useAuthStore.getState().user) return;
      swapSuggestionEngine(state.engineId).catch((err) => {
        console.error('[Chessr] engine swap failed:', err);
      });
    });

    // Request suggestions when it's the player's turn
    useGameStore.subscribe((state, prev) => {
      const { isPlaying, fen, playerColor, turn, gameOver } = state;

      // Clear on new game or game over — cancel in-flight search too so a
      // late response doesn't repopulate arrows after the game ended.
      if (!isPlaying || gameOver) {
        resetSuggestionState();
        return;
      }

      if (!playerColor || !turn || !fen || playerColor !== turn) {
        clearArrows();
        resetSuggestionState();
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
        }).catch(() => {
          // If Stockfish crashed the `ready` flag will have been cleared
          // by the engine's error handler — re-init so the next move's
          // eval bar update can still work.
          if (!analysisEngine?.ready) {
            try { analysisEngine?.destroy(); } catch { /* ignore */ }
            analysisEngine = null;
            const jsUrl = browser.runtime.getURL('/engine/stockfish.js');
            const wasmUrl = browser.runtime.getURL('/engine/stockfish.wasm');
            analysisEngine = new AnalysisEngine();
            analysisEngine.init(jsUrl, wasmUrl).catch((err) => {
              console.error('[Chessr] Stockfish re-init failed:', err);
              analysisEngine = null;
            });
          }
        });
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

          // If a pending newGame reset is queued and this mode event confirms
          // we're back to playing on the SAME fen that was current before
          // newGame fired, the newGame was spurious — cancel the reset.
          if (isGameMode && newGameResetTimer && data.fen && pendingNewGameFen && data.fen === pendingNewGameFen) {
            clearTimeout(newGameResetTimer);
            newGameResetTimer = null;
            pendingNewGameFen = null;
            console.log('[Chessr][dbg] spurious chessr:newGame cancelled (fen unchanged)');
          }
          // Only set playing to true, never back to false from mode changes
          // (game end is handled by gameOver flag, new game by chessr:newGame)
          if (isGameMode && !currentlyPlaying) setPlaying(true);
          if (data.playingAs) setPlayerColor(toColor(data.playingAs));
          // While actually playing, chess.com's getPositionInfo / getResult may
          // briefly return stale game-over state (carried over from the previous
          // game reusing the same object). Trust `name === 'playing'` as ground
          // truth and ignore stale game-over flags.
          //
          // Additionally, chess.com sometimes emits a passive-observing frame
          // with `gameOver: true` but no definitive `result` — the game then
          // immediately resumes on the same position (a transient UI quirk).
          // Only accept gameOver=true when the result field confirms it, so
          // we don't wipe the engine state on these false alarms.
          const definitiveResult = !!data.result && data.result !== '*';
          const gameOver = isGameMode ? false : (!!data.gameOver && definitiveResult);
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
        case 'chessr:newGame': {
          // chess.com occasionally emits a transient newGame on the same
          // position (right after a spurious `gameOver`). Debounce: remember
          // the FEN we saw before the event and defer the reset. If a
          // chessr:mode playing on the SAME fen lands within the window,
          // cancel the reset — the game in fact continues.
          const fenAtNewGame = useGameStore.getState().fen;
          pendingNewGameFen = fenAtNewGame;
          if (newGameResetTimer) clearTimeout(newGameResetTimer);
          newGameResetTimer = setTimeout(() => {
            newGameResetTimer = null;
            pendingNewGameFen = null;
            reset();
            resetSuggestionState();
            suggestionEngine?.newGame().catch(() => { /* engine gone */ });
            useAnalysisStore.getState().reset();
            useExplanationStore.getState().clear();
            useEvalStore.getState().reset();
            previousFen = null;
            playerMoveCount = 0;
          }, 200);
          break;
        }
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
