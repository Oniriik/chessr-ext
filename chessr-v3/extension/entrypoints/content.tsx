import ReactDOM from 'react-dom/client';
import App from './content/App';
import { installDiagCapture, recordChessrEvent, recordEngineSwap } from './content/lib/diagBuffer';

// Patch console.warn / .error + window.onerror into a ring buffer so the
// Settings → Copy debug logs button can dump everything for support.
installDiagCapture();
import { useGameStore, toColor, type Color } from './content/stores/gameStore';
import { useSuggestionStore } from './content/stores/suggestionStore';
import { connectWs, disconnectWs, sendWs } from './content/lib/websocket';
import { useAuthStore } from './content/stores/authStore';
import { useSettingsStore } from './content/stores/settingsStore';
import { renderArrows, clearArrows } from './content/lib/arrows';
import { installArrowDrag } from './content/lib/dragArrows';
import { initEvalBar } from './content/lib/evalBar';
import { ServerAnalysisEngine } from './content/lib/serverAnalysisEngine';
import { TorchAnalysisEngine } from './content/lib/torchAnalysisEngine';
import { setTorchLiveEngine } from './content/lib/torchLiveRef';
import type { TorchAnalysis } from './content/lib/torchJson';
import { uciFromFens, historyMatchesFen } from './content/lib/uciFromFens';
import type { AnalysisBackend } from './content/lib/moveAnalysis';

function analysisSource(): 'wasm' | 'server' {
  if (torchAnalysisEngine?.ready) return 'wasm';
  return analysisEngine instanceof ServerAnalysisEngine ? 'server' : 'wasm';
}
import { SuggestionEngine } from './content/lib/suggestionEngine';
import { MaiaSuggestionEngine } from './content/lib/maiaSuggestionEngine';
import { Maia3SuggestionEngine } from './content/lib/maia3SuggestionEngine';
import { StockfishSuggestionEngine } from './content/lib/stockfishSuggestionEngine';
import { TorchSuggestionEngine } from './content/lib/torchSuggestionEngine';
import { ServerEngine } from './content/lib/serverEngine';
import type { IEngine, SuggestionSearchParams as EngineSearchParams } from './content/lib/engineApi';
import type { EngineId } from './content/stores/engineStore';
import { analyzeLastMove } from './content/lib/moveAnalysis';
import { useAnalysisStore } from './content/stores/analysisStore';
import { useExplanationStore } from './content/stores/explanationStore';
import { useEngineStore } from './content/stores/engineStore';
import { animationGate } from './content/stores/animationStore';
import { useEvalStore } from './content/stores/evalStore';
import { installHotkeyListener, installAutoPlayScheduler } from './content/lib/autoMoveScheduler';
import { isPremiumPlan } from './content/lib/premium';
import { installStreamSync } from './content/lib/streamSync';
let lastRequestedFen: string | null = null;
let analysisEngine: (AnalysisBackend & { ready: boolean; destroy(): void }) | null = null;
/** Primary slot when torch.wasm is available. Coexists with `analysisEngine`
 *  (which is populated only in degraded mode = server SF fallback). The two
 *  slots are mutually exclusive in practice: at any given time, exactly one
 *  is non-null after `buildLiveAnalysis()` resolves. */
let torchAnalysisEngine: TorchAnalysisEngine | null = null;

/** WASM-first live analysis. Tries torch.wasm in the extension; on failure,
 *  falls back to the existing server SF native via WebSocket (degraded mode:
 *  eval bar still works, but no CAPS / effective Elo / 11-class native
 *  classifications). Populates one of the two module-scope slots. */
async function buildLiveAnalysis(): Promise<void> {
  // Reset both slots first (handles re-init after a crash).
  try { torchAnalysisEngine?.destroy(); } catch { /* ignore */ }
  try { analysisEngine?.destroy(); } catch { /* ignore */ }
  torchAnalysisEngine = null;
  analysisEngine = null;
  setTorchLiveEngine(null);

  if (forceServerSet().has('torch')) {
    console.log('[Chessr] chessrForceServer set for torch → server SF analysis fallback');
    const srv = new ServerAnalysisEngine();
    await srv.init();
    analysisEngine = srv;
    recordEngineSwap({ slot: 'analysis', engineId: 'torch', mode: 'server', success: true, detail: 'forced via chessrForceServer' });
    return;
  }

  // Always bring up the server-SF fallback alongside torch. Torch can't
  // analyse mid-game-rooted positions (its `position fen X + fetch
  // analysis` crashes the wasm), so when chessr loads on a chess.com
  // /play/computer continuation game, we route eval-bar updates through
  // the server SF instead. ServerAnalysisEngine.init is a no-op (just
  // sets _ready = true) so this is essentially free.
  const srvFallback = new ServerAnalysisEngine();
  await srvFallback.init();
  analysisEngine = srvFallback;

  const torch = new TorchAnalysisEngine();
  try {
    if (forceFailSet().has('torch')) {
      throw new Error('chessrFailWasm set for torch → simulated init failure');
    }
    await Promise.race([
      torch.init(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('torch wasm init timeout')), 3000)),
    ]);
    torchAnalysisEngine = torch;
    setTorchLiveEngine(torch);
    console.log('[Chessr] live analysis ready (torch WASM + server SF fallback for mid-game starts)');
    recordEngineSwap({ slot: 'analysis', engineId: 'torch', mode: 'wasm', success: true });
    useEngineStore.getState().setTorchAvailable(true);
    // Expose stores on window for DevTools inspection (read-only debug aid).
    (window as any).__chessr = {
      analysisStore: useAnalysisStore,
      engineStore: useEngineStore,
      gameStore: useGameStore,
      torchEngine: () => torchAnalysisEngine,
    };
    return;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn('[Chessr] Torch WASM failed, server SF fallback already up', err);
    try { torch.destroy(); } catch { /* ignore */ }
    // analysisEngine (ServerAnalysisEngine) is already populated above.
    console.log('[Chessr] live analysis ready (server fallback, degraded mode)');
    recordEngineSwap({ slot: 'analysis', engineId: 'torch', mode: 'server', success: true, detail: `wasm fail: ${errMsg}` });
    useEngineStore.getState().setTorchAvailable(false);
  }
}
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

/**
 * WASM-first engine builder with server fallback.
 *
 * Browsers where WASM can't load (iOS Orion, Windows AV strips binaries, old
 * Chromium without SIMD, low-memory devices) won't get a working WASM init
 * in 3 seconds. We cap the WASM attempt at 3s, terminate the engine on
 * failure, and return a ServerEngine that proxies searches to the OVH
 * native Komodo / Maia instead. Desktop Chrome inits in <1s so there's no
 * visible regression for working environments.
 */
const WASM_INIT_TIMEOUT_MS = 3000;

function newWasmEngine(id: EngineId): IEngine {
  switch (id) {
    case 'maia2':     return new MaiaSuggestionEngine();
    case 'maia3':     return new Maia3SuggestionEngine();
    case 'stockfish': return new StockfishSuggestionEngine();
    case 'torch':     return new TorchSuggestionEngine();
    default:          return new SuggestionEngine(); // 'komodo'
  }
}

/** Parse the chessrForceServer localStorage flag into a Set of engine
 *  identifiers that should skip WASM. Accepts:
 *    '1' or 'all' → ['komodo', 'maia2', 'stockfish']
 *    'komodo'     → ['komodo']
 *    'komodo,maia2,stockfish' (any subset)
 *  Anything else / unset → empty Set (no override). */
function forceServerSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = localStorage.chessrForceServer;
  if (!raw) return new Set();
  if (raw === '1' || raw === 'all') return new Set(['komodo', 'maia2', 'maia3', 'stockfish', 'torch']);
  return new Set(raw.split(',').map((s: string) => s.trim()).filter(Boolean));
}

/** Sister flag: simulate a WASM init *failure* so the catch → fallback path
 *  is exercised (vs forceServerSet which just skips WASM). Same syntax. */
function forceFailSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = localStorage.chessrFailWasm;
  if (!raw) return new Set();
  if (raw === '1' || raw === 'all') return new Set(['komodo', 'maia2', 'maia3', 'stockfish', 'torch']);
  return new Set(raw.split(',').map((s: string) => s.trim()).filter(Boolean));
}

async function createEngine(id: EngineId): Promise<IEngine> {
  // DEV affordance: skip WASM and force the server path. Toggle from
  // DevTools console:
  //   `localStorage.chessrForceServer = '1'`        → all engines
  //   `localStorage.chessrForceServer = 'komodo'`   → only Komodo
  //   `localStorage.chessrForceServer = 'maia2,stockfish'` → both
  // Then reload. To restore: `delete localStorage.chessrForceServer`.
  if (forceServerSet().has(id)) {
    console.log(`[Chessr] chessrForceServer set for ${id} → server engine`);
    const srv = new ServerEngine(id);
    await srv.init();
    recordEngineSwap({ slot: 'suggestion', engineId: id, mode: 'server', success: true, detail: 'forced via chessrForceServer' });
    return srv;
  }

  const wasmEng = newWasmEngine(id);
  try {
    // DEV: simulate a WASM init failure to exercise the catch-fallback path.
    if (forceFailSet().has(id)) {
      throw new Error(`chessrFailWasm set for ${id} → simulated init failure`);
    }
    await Promise.race([
      wasmEng.init(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('wasm init timeout')), WASM_INIT_TIMEOUT_MS)),
    ]);
    console.log(`[Chessr] engine ready (WASM): ${id}`);
    recordEngineSwap({ slot: 'suggestion', engineId: id, mode: 'wasm', success: true });
    return wasmEng;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[Chessr] WASM engine ${id} failed, falling back to server`, err);
    try { wasmEng.destroy(); } catch { /* ignore */ }
    const srv = new ServerEngine(id);
    await srv.init();
    console.log(`[Chessr] engine ready (server fallback): ${id}`);
    recordEngineSwap({ slot: 'suggestion', engineId: id, mode: 'server', success: true, detail: `wasm fail: ${errMsg}` });
    return srv;
  }
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
  if (!force && fen === lastRequestedFen) {
    console.log('[Chessr][req] skip (same fen as last)');
    return;
  }
  lastRequestedFen = fen;

  if (!useAuthStore.getState().user) {
    console.log('[Chessr][req] skip (no user)');
    return;
  }
  if (!suggestionEngine?.ready) {
    console.log('[Chessr][req] skip (engine not ready)', { id: suggestionEngine?.id, ready: suggestionEngine?.ready });
    return;
  }

  // Debounce: when moves come rapid-fire (game review, bot auto-move),
  // only the last position in the window triggers a real search.
  // `force` bypasses the debounce for one-shot catch-ups (init-complete
  // re-fire, chessr:rescan).
  if (suggestionDebounce) clearTimeout(suggestionDebounce);
  const delay = force ? 0 : SUGGESTION_DEBOUNCE_MS;
  console.log('[Chessr][req] queuing search', { delay, fen: fen.slice(0, 22) + '…' });
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
  if (suggestionEngine.id === 'maia2' || suggestionEngine.id === 'maia3') {
    params = {
      fen,
      moves: [] as string[],
      multiPv: numArrows,
      eloSelf: engine.getMaiaEffectiveTargetElo(),
      eloOppo: engine.getMaiaEffectiveOppoElo(),
      variant: engine.maiaVariant,
      useBook: suggestionEngine.id === 'maia2' ? engine.maiaUseBook : false,
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

  // Telemetry: log the search on the server. `source` tag tells the
  // dashboard whether the engine ran in-browser (wasm) or was proxied to
  // the server-side native binary (server fallback). E2E latency is the
  // time between this log_start and the matching log_end below — server
  // path adds one WS round-trip + queue wait + native engine compute.
  const engineLabel = suggestionEngine.id;
  const source = suggestionEngine instanceof ServerEngine ? 'server' : 'wasm';
  const extra = (() => {
    if (engineLabel === 'maia2' || engineLabel === 'maia3') {
      return `source=${source} engine=${engineLabel} variant=${params.variant} eloSelf=${params.eloSelf} eloOppo=${params.eloOppo} mpv=${params.multiPv}`;
    }
    const searchDesc = params.search
      ? `${params.search.mode}:${
          params.search.mode === 'depth' ? params.search.depth
          : params.search.mode === 'nodes' ? params.search.nodes
          : params.search.mode === 'movetime' ? params.search.movetime
          : '?'
        }`
      : 'default';
    // Stockfish has no personality knob — only Komodo does. Omit it from
    // the log on stockfish so the line doesn't lie ("perso=Default" looked
    // like the user picked Default but the field isn't applicable).
    const persoBit = engineLabel === 'stockfish' ? '' : ` perso=${params.personality}`;
    return `source=${source} engine=${engineLabel} elo=${params.targetElo} mpv=${params.multiPv} limit=${params.limitStrength}${persoBit} search=${searchDesc}`;
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
  matches: ['*://chess.com/*', '*://*.chess.com/*', '*://lichess.org/*', '*://*.lichess.org/*', '*://worldchess.com/*', '*://*.worldchess.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Init eval bar in page DOM (outside Shadow Root)
    initEvalBar();

    // Auto Move: install hotkey listener + auto-play scheduler
    installHotkeyListener();
    installAutoPlayScheduler();
    // Mirror the live game state to chrome.storage so the Stream Mode
    // page (separate extension tab) can render the same board + arrows.
    installStreamSync();
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
        // Komodo / Stockfish — ELO + tuning + search budget
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
        state.searchMovetime !== prev.searchMovetime ||
        // Maia 2 / Maia 3 — separate ELO + variant + book
        state.maiaTargetEloAuto !== prev.maiaTargetEloAuto ||
        state.maiaTargetEloManual !== prev.maiaTargetEloManual ||
        state.maiaOppoEloAuto !== prev.maiaOppoEloAuto ||
        state.maiaOppoEloManual !== prev.maiaOppoEloManual ||
        state.maiaUseBook !== prev.maiaUseBook ||
        state.maiaVariant !== prev.maiaVariant;
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
        if (!analysisEngine && !torchAnalysisEngine) {
          buildLiveAnalysis().catch((err) => {
            console.error('[Chessr] Failed to init live analysis:', err);
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
        console.log('[Chessr][gate] reset (idle):', { isPlaying, gameOver });
        resetSuggestionState();
        return;
      }

      if (!playerColor || !turn || !fen || playerColor !== turn) {
        console.log('[Chessr][gate] not our turn:', { playerColor, turn, hasFen: !!fen });
        clearArrows();
        resetSuggestionState();
        return;
      }

      // Trigger when: position changed, turn switched to us, game just started,
      // or player color changed (covers null→colour AND colour→colour, the
      // latter happens between two consecutive puzzles where you alternate
      // sides).
      const positionChanged = fen !== prev.fen;
      const turnChanged = turn !== prev.turn;
      const gameJustStarted = isPlaying && !prev.isPlaying;
      const playerColorChanged = playerColor !== prev.playerColor;

      if (positionChanged || turnChanged || gameJustStarted || playerColorChanged) {
        console.log('[Chessr][gate] firing requestSuggestion', { positionChanged, turnChanged, gameJustStarted, playerColorChanged, fen: fen.slice(0, 22) + '…' });
        // Clear stale arrows immediately on FEN change — keeps storm/racer
        // (rapid puzzle transitions) from showing the previous puzzle's arrows
        // while the new search is in flight (server can take 1-2s).
        if (positionChanged) useSuggestionStore.getState().clear();
        requestSuggestion(fen);
      } else {
        console.log('[Chessr][gate] no-change skip', { fen: fen.slice(0, 22) + '…' });
      }
    });

    // Analyze player's last move when turn switches to opponent.
    //
    // Gate on actual FEN transition: useGameStore.subscribe fires on every
    // store mutation (playerColor, isPlaying, gameOver, etc.) — without
    // this guard the eval-bar update was firing 10–20× per move because
    // `previousFen !== state.fen` stayed true on every non-FEN re-fire.
    useGameStore.subscribe((state, prev) => {
      if (prev.fen === state.fen) return;
      if (prev.fen) previousFen = prev.fen;

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

      // Maintain moveHistoryUci on every detected move (player OR opponent),
      // before any analysis call — torch's fetch_analysis takes a full
      // history. Derive UCI from previous→current FEN.
      const aMoveHappened =
        previousFen !== null && previousFen !== state.fen && !!state.fen &&
        state.isPlaying && !state.gameOver;
      if (aMoveHappened) {
        const uci = uciFromFens(previousFen!, state.fen!);
        if (uci) useGameStore.getState().pushUciMove(uci);
      }

      if (playerJustMoved && (torchAnalysisEngine?.ready || analysisEngine?.ready)) {
        playerMoveCount++;
        const moveNumber = parseMoveNumber(previousFen!);
        const fenBefore = previousFen!;
        const fenAfter = state.fen!;

        const arid = `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const src = analysisSource();
        sendWs({ type: 'analysis_log_start', requestId: arid,
                 extra: `source=${src} move=#${moveNumber}` });

        useAnalysisStore.getState().setAnalyzing(true);

        const history = useGameStore.getState().moveHistoryUci;
        const torchFullUsable = torchAnalysisEngine?.ready && historyMatchesFen(history, fenAfter);

        if (torchFullUsable) {
          // Torch fetch_analysis path — full game analysis with CAPS, Elo,
          // 11-class classifications. Only when game is rooted at startpos.
          torchAnalysisEngine!.fetchFullAnalysis(history)
            .then((result: TorchAnalysis) => {
              useAnalysisStore.getState().applyTorchAnalysis(result);
              animationGate.markEvent('analysis');
              const last = result.moveAnalyses[result.moveAnalyses.length - 1];
              if (last) {
                const pc = useGameStore.getState().playerColor;
                const evalWhite = pc === 'black' ? -last.evaluation : last.evaluation;
                useEvalStore.getState().setEval(evalWhite);
                sendWs({ type: 'analysis_log_end', requestId: arid,
                         extra: `${last.classification} (torch)` });
              } else {
                sendWs({ type: 'analysis_log_end', requestId: arid, extra: 'empty' });
              }
            })
            .catch((err) => {
              console.error('[Chessr][torch] live analysis error:', err);
              sendWs({ type: 'analysis_log_end', requestId: arid,
                       extra: `fail:${err?.message || 'unknown'}` });
              // Engine may have aborted (wasm crash); re-init silently so
              // the next move is analysed by a fresh worker.
              if (!torchAnalysisEngine?.ready) {
                buildLiveAnalysis().catch((e) =>
                  console.error('[Chessr] live-analysis re-init failed:', e));
              }
            })
            .finally(() => {
              useAnalysisStore.getState().setAnalyzing(false);
            });
        } else {
          // UCI standard path — works for any position (mid-game starts,
          // continuation games on chess.com /play/computer, etc.). Prefers
          // torch.wasm (analyze(fen) does `position fen X` + `go depth N`)
          // and falls back to ServerAnalysisEngine if torch isn't up.
          const liveBackend = torchAnalysisEngine?.ready ? torchAnalysisEngine : analysisEngine;
          if (liveBackend?.ready) {
            analyzeLastMove(fenBefore, fenAfter, liveBackend)
              .then((result) => {
                useAnalysisStore.getState().addAnalysis({ ...result, moveNumber });
                animationGate.markEvent('analysis');
                const pc = useGameStore.getState().playerColor;
                const evalWhite = pc === 'black' ? -result.evalAfter : result.evalAfter;
                useEvalStore.getState().setEval(evalWhite);
                sendWs({ type: 'analysis_log_end', requestId: arid,
                         extra: `${result.classification} caps2=${result.caps2}` });
              })
              .catch((err) => {
                console.error('[Chessr] Analysis error:', err);
                sendWs({ type: 'analysis_log_end', requestId: arid,
                         extra: `fail:${err?.message || 'unknown'}` });
              })
              .finally(() => {
                useAnalysisStore.getState().setAnalyzing(false);
              });
          } else {
            useAnalysisStore.getState().setAnalyzing(false);
          }
        }
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

      if (opponentJustMoved && (torchAnalysisEngine?.ready || analysisEngine?.ready)) {
        const erid = `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const src = analysisSource();
        sendWs({ type: 'eval_log_start', requestId: erid, extra: `source=${src}` });

        const history = useGameStore.getState().moveHistoryUci;
        const torchFullUsableOpp = torchAnalysisEngine?.ready && historyMatchesFen(history, state.fen!);

        if (torchFullUsableOpp) {
          // Torch fetch_analysis path — full game stats refresh.
          torchAnalysisEngine!.fetchFullAnalysis(history).then((result) => {
            useAnalysisStore.getState().applyTorchAnalysis(result);
            const last = result.moveAnalyses[result.moveAnalyses.length - 1];
            if (last) {
              const pc = useGameStore.getState().playerColor;
              // Opponent just moved — last entry is from opponent's POV. Negate
              // for player POV (consistent with the SF path's evalAfter shape).
              const evalPlayerPov = -last.evaluation;
              const evalWhite = pc === 'black' ? -evalPlayerPov : evalPlayerPov;
              useEvalStore.getState().setEval(evalWhite);
            }
            sendWs({ type: 'eval_log_end', requestId: erid,
                     extra: `eval=${last?.evaluation ?? '?'} (torch)` });
          }).catch((err) => {
            sendWs({ type: 'eval_log_end', requestId: erid, extra: `fail:${err?.message || 'unknown'}` });
            if (!torchAnalysisEngine?.ready) {
              buildLiveAnalysis().catch((e) =>
                console.error('[Chessr] live-analysis re-init failed:', e));
            }
          });
        } else {
          // UCI standard single-FEN eval — torch.wasm preferred, server SF
          // fallback. Same path used in the playerJustMoved else-branch.
          const evalBackend = torchAnalysisEngine?.ready ? torchAnalysisEngine : analysisEngine;
          if (evalBackend?.ready) {
            evalBackend.analyze(state.fen!).then((result) => {
              const pc = useGameStore.getState().playerColor;
              const evalWhite = pc === 'black' ? -result.evaluation / 100 : result.evaluation / 100;
              useEvalStore.getState().setEval(evalWhite);
              sendWs({ type: 'eval_log_end', requestId: erid,
                       extra: `bestMove=${result.bestMove} eval=${result.evaluation}cp d${result.depth}` });
            }).catch((err) => {
              sendWs({ type: 'eval_log_end', requestId: erid, extra: `fail:${err?.message || 'unknown'}` });
              // Re-init the live engines if either died.
              if (!evalBackend?.ready) {
                buildLiveAnalysis().catch((e) =>
                  console.error('[Chessr] live-analysis re-init failed:', e));
              }
            });
          }
        }
      }
    });

    // Listen for events from pageContext (MAIN world)
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (typeof data?.type !== 'string' || !data.type.startsWith('chessr:')) return;

      // CDP relay: lichess executeMove asks the background to inject native
      // mouse events via chrome.debugger. MAIN-world adapter can't reach
      // chrome.runtime, so we relay here. Gated to lichess hostname so
      // chess.com / worldchess never trigger the debugger banner.
      if (data.type === 'chessr:cdpMouseMove' && /(^|\.)lichess\.org$/.test(location.hostname)) {
        browser.runtime.sendMessage({
          type: 'cdpMouseMove',
          fromX: data.fromX, fromY: data.fromY,
          toX: data.toX, toY: data.toY,
          pickDelay: data.pickDelay,
          selectDelay: data.selectDelay,
          moveDelay: data.moveDelay,
        }).catch(() => { /* background may be reloading */ });
        return;
      }
      if (data.type === 'chessr:cdpClick' && /(^|\.)lichess\.org$/.test(location.hostname)) {
        browser.runtime.sendMessage({
          type: 'cdpClick',
          x: data.x, y: data.y,
        }).catch(() => { /* background may be reloading */ });
        return;
      }

      console.log(`[Chessr] ${data.type}`, data);
      recordChessrEvent(data.type, data);

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
          // the FEN we saw before the event and defer the heavy resets
          // (gameStore wipe + engine re-init) so a spurious-newGame doesn't
          // visibly flicker the panel. If a chessr:mode playing on the SAME
          // fen lands within the window, cancel — the game in fact continues.
          const fenAtNewGame = useGameStore.getState().fen;
          pendingNewGameFen = fenAtNewGame;

          // EAGER resets: the per-move annotation stores (analysis /
          // explanations / eval graph) are safe to wipe immediately —
          // worst case is a spurious newGame on the same position, in
          // which case the next move will just rebuild them. Without
          // this, the cancel-logic on chess.com (where two games starting
          // at startpos look identical to "spurious") leaves the previous
          // game's accuracy/classifications visible on the new game.
          useAnalysisStore.getState().reset();
          useExplanationStore.getState().clear();
          useEvalStore.getState().reset();

          if (newGameResetTimer) clearTimeout(newGameResetTimer);
          newGameResetTimer = setTimeout(() => {
            newGameResetTimer = null;
            pendingNewGameFen = null;
            reset();
            resetSuggestionState();
            suggestionEngine?.newGame().catch(() => { /* engine gone */ });
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
        // Stop keyboard events from leaking to the host page's global key
        // handlers (Lichess `mousetrap` focuses the in-game chat on plain
        // letter keys; without this, typing in our login input would steal
        // the keystrokes).
        const stopKey = (e: Event) => e.stopPropagation();
        container.addEventListener('keydown', stopKey);
        container.addEventListener('keyup', stopKey);
        container.addEventListener('keypress', stopKey);

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
