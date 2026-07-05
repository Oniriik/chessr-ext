import ReactDOM from 'react-dom/client';
import App from './content/App';
import { installDiagCapture, recordChessrEvent, recordEngineSwap } from './content/lib/diagBuffer';

// Patch console.warn / .error + window.onerror into a ring buffer so the
// Settings → Copy debug logs button can dump everything for support.
installDiagCapture();
import { useGameStore, toColor, type Color } from './content/stores/gameStore';
import { useSuggestionStore } from './content/stores/suggestionStore';
import { connectWs, disconnectWs, sendWs, onWsMessage } from './content/lib/websocket';
import { useWidgetStore, type SystemMessage } from './content/stores/widgetStore';
import { useAuthStore } from './content/stores/authStore';
import { useSettingsStore } from './content/stores/settingsStore';
import { renderArrows, clearArrows, clearPersistentArrows, redrawPersistentArrows, applyClassificationsToBoard, setOpponentMove, setMyLastMove } from './content/lib/arrows';
import { installArrowDrag } from './content/lib/dragArrows';
import { initEvalBar } from './content/lib/evalBar';
import { ServerAnalysisEngine } from './content/lib/serverAnalysisEngine';
import { TorchAnalysisEngine } from './content/lib/torchAnalysisEngine';
import { setTorchLiveEngine } from './content/lib/torchLiveRef';
import type { TorchAnalysis } from './content/lib/torchJson';
import { uciFromFens, uciPairFromFens, historyMatchesFen } from './content/lib/uciFromFens';
import { serverModeActive, startServerEngineRouter } from './content/lib/serverEngineRouter';
import { Chess } from 'chess.js';
import type { AnalysisBackend } from './content/lib/moveAnalysis';

function analysisSource(): 'wasm' | 'server' {
  if (torchAnalysisEngine?.ready) return 'wasm';
  return analysisEngine instanceof ServerAnalysisEngine ? 'server' : 'wasm';
}
import { SuggestionEngine } from './content/lib/suggestionEngine';
import { Maia3SuggestionEngine } from './content/lib/maia3SuggestionEngine';
import { RodentSuggestionEngine } from './content/lib/rodentSuggestionEngine';
import { StockfishSuggestionEngine } from './content/lib/stockfishSuggestionEngine';
import { ServerEngine } from './content/lib/serverEngine';
import type { IEngine, SuggestionSearchParams as EngineSearchParams } from './content/lib/engineApi';
import type { EngineId } from './content/stores/engineStore';
import { analyzeLastMove } from './content/lib/moveAnalysis';
import { useAnalysisStore } from './content/stores/analysisStore';
import { useExplanationStore } from './content/stores/explanationStore';
import { useEngineStore } from './content/stores/engineStore';
import { animationGate } from './content/stores/animationStore';
import { useEvalStore } from './content/stores/evalStore';
import { installHotkeyListener, installAutoPlayScheduler, installAutoPauseHotkey } from './content/lib/autoMoveScheduler';
import { isPremiumPlan } from './content/lib/premium';
import { installStreamSync } from './content/lib/streamSync';
import { initStreamOpenCache, subscribeStreamOpen } from './content/lib/streamOpen';
import { installWidgetSync } from './content/lib/widgetSync';
let lastRequestedFen: string | null = null;
/** Server SF fallback. Populated only when torch.wasm fails to init; in
 *  the happy path both torch engines below carry the load. */
let analysisEngine: (AnalysisBackend & { ready: boolean; destroy(): void }) | null = null;
/** Torch in 'rich' mode (with UseDeclarativePositionCommand=true) — used for
 *  fetch_analysis on startpos-rooted games. Returns CAPS / Effective Elo /
 *  11-class. Crashes on `position fen X` (so cannot do mid-game eval). */
let torchAnalysisEngine: TorchAnalysisEngine | null = null;
/** Torch in 'uci' mode (without UseDeclarativePositionCommand) — used for
 *  plain UCI `position fen X` + `go depth N` on any position. Drop-in for
 *  the legacy SF AnalysisEngine. Used when game isn't startpos-rooted. */
let torchUciEngine: TorchAnalysisEngine | null = null;

/** Re-init backoff state. After repeated init failures we space out the
 *  retries so we don't hammer torch.wasm if it's permanently broken on
 *  this device (low-mem mobile, AV-stripped binary, etc.). */
let lastInitAttemptAt = 0;
let consecutiveInitFailures = 0;

/** WASM-first live analysis. Tries torch.wasm in the extension; on failure,
 *  falls back to the existing server SF native via WebSocket (degraded mode:
 *  eval bar still works, but no CAPS / effective Elo / 11-class native
 *  classifications). Populates one of the two module-scope slots.
 *
 *  No-op (resolves immediately) if a recent failure means we're in the
 *  exponential-backoff window — caller must handle the resulting null slots. */
async function buildLiveAnalysis(): Promise<void> {
  // Backoff: 0 / 2s / 8s / 30s / 60s caps, after each failure.
  const backoffMs = consecutiveInitFailures === 0 ? 0
    : Math.min(60_000, 2_000 * Math.pow(2, consecutiveInitFailures - 1));
  const sinceLastAttempt = Date.now() - lastInitAttemptAt;
  if (sinceLastAttempt < backoffMs) {
    console.log('[Chessr] live-analysis init backoff:', backoffMs - sinceLastAttempt, 'ms remaining');
    return;
  }
  lastInitAttemptAt = Date.now();

  // Reset all slots first (handles re-init after a crash).
  try { torchAnalysisEngine?.destroy(); } catch { /* ignore */ }
  try { torchUciEngine?.destroy(); } catch { /* ignore */ }
  try { analysisEngine?.destroy(); } catch { /* ignore */ }
  torchAnalysisEngine = null;
  torchUciEngine = null;
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

  const torchRich = new TorchAnalysisEngine({ mode: 'rich' });
  const torchUci = new TorchAnalysisEngine({ mode: 'uci' });
  try {
    if (forceFailSet().has('torch')) {
      throw new Error('chessrFailWasm set for torch → simulated init failure');
    }
    // Boot both workers in parallel — same wasm binary, both inits should
    // succeed/fail together. Total cost ~52 MB RAM, ~2-3s init time.
    await Promise.race([
      Promise.all([torchRich.init(), torchUci.init()]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('torch wasm init timeout')), 5000)),
    ]);
    torchAnalysisEngine = torchRich;
    torchUciEngine = torchUci;
    setTorchLiveEngine(torchRich);
    consecutiveInitFailures = 0;
    console.log('[Chessr] live analysis ready (torch WASM × 2: rich for fetch_analysis, uci for any-FEN eval)');
    // Push current ratings into the rich worker so its 11-class classifier
    // is calibrated for THIS game (not the 1500/1500 init defaults). Same
    // logic as the chessr:ratings handler — runs here for the case where
    // ratings arrived before torch finished booting.
    {
      const pc = useGameStore.getState().playerColor;
      const userElo = useEngineStore.getState().userElo;
      const oppElo = useEngineStore.getState().opponentElo;
      console.log('[Chessr] post-init: known ratings', { pc, userElo, oppElo });
      if (userElo > 0 && oppElo > 0) {
        const whiteElo = pc === 'black' ? oppElo : userElo;
        const blackElo = pc === 'black' ? userElo : oppElo;
        torchRich.setRatings(whiteElo, blackElo).catch((err) =>
          console.warn('[Chessr][torch] initial setRatings failed:', err));
      }
    }
    recordEngineSwap({ slot: 'analysis', engineId: 'torch', mode: 'wasm', success: true });
    useEngineStore.getState().setTorchAvailable(true);
    // Expose stores on window for DevTools inspection (read-only debug aid).
    (window as any).__chessr = {
      analysisStore: useAnalysisStore,
      engineStore: useEngineStore,
      gameStore: useGameStore,
      torchEngine: () => torchAnalysisEngine,
    };
    // If chessr loaded mid-game and history was already seeded, kick off
    // an initial fetch_analysis so the Performance Card has stats to show
    // before the user makes the next move.
    triggerInitialAnalysisIfSeeded();
    return;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    consecutiveInitFailures += 1;
    console.warn('[Chessr] Torch WASM failed, falling back to server SF (', consecutiveInitFailures, 'consecutive failures)', err);
    try { torchRich.destroy(); } catch { /* ignore */ }
    try { torchUci.destroy(); } catch { /* ignore */ }
    const srv = new ServerAnalysisEngine();
    await srv.init();
    analysisEngine = srv;
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

// Torch rebuild cooldown — torch (CEE) accumulates state between games
// (ucinewgame is banned, see torchAnalysisEngine.ts:155-158) so we rebuild
// the workers on every real chessr:newGame. The rebuild MUST live OUTSIDE
// the newGameResetTimer below because that timer gets clearTimeout()'d by
// the chessr:mode handler at line ~1070 whenever a `playing` event arrives
// on the same FEN within 200ms — which happens for EVERY real new bot game
// (chess.com always confirms playing mode right after newGame). With the
// rebuild inside that timer, it never fires for the cases that need it.
// Module-level cooldown absorbs bursts (chess.com fires 3-4 newGames in
// ~0.5s on real game transitions — verified in debug dumps).
const TORCH_REBUILD_MIN_INTERVAL_MS = 5000;
let lastTorchRebuildAt = 0;

/** Run a fetch_analysis on the seeded history so the Performance Card has
 *  stats to show before the user makes the next move. Idempotent (skips
 *  if moveAnalyses is already populated). Robust to the occasional wasm
 *  abort: catches, lets buildLiveAnalysis re-init, then the next move
 *  will fire the regular flow.
 *
 *  Called from two places:
 *    - buildLiveAnalysis() success path: torch came up after a seeded
 *      history was already in place
 *    - chessr:initialMoves handler: seed arrived after torch was up
 *  Both trigger the same idempotent flow. */
let initialAnalysisInFlight = false;
/** Hash of the last history that triggered a fetch_analysis crash. We
 *  refuse to retry the SAME history — would cause an infinite re-init
 *  loop (torch aborts → we reinit → trigger same analysis → aborts...).
 *  Reset when the history grows (player makes a new move). */
let lastFailedHistoryHash: string | null = null;
async function triggerInitialAnalysisIfSeeded(): Promise<void> {
  if (initialAnalysisInFlight) return;
  if (!torchAnalysisEngine?.ready) return;
  const history = useGameStore.getState().moveHistoryUci;
  if (history.length === 0) return;
  const fen = useGameStore.getState().fen;
  if (!fen) return;
  if (!historyMatchesFen(history, fen)) return;
  const histHash = history.join(' ');
  if (histHash === lastFailedHistoryHash) {
    console.log('[Chessr] skip initial analysis — same history already failed (', history.length, 'moves). Waiting for next move.');
    return;
  }

  initialAnalysisInFlight = true;
  console.log('[Chessr] firing initial fetch_analysis on seeded history (', history.length, 'moves):', history.join(' '));
  useAnalysisStore.getState().setAnalyzing(true);
  try {
    const result = await torchAnalysisEngine.fetchFullAnalysis(history);
    useAnalysisStore.getState().applyTorchAnalysis(result);
    const last = result.moveAnalyses[result.moveAnalyses.length - 1];
    if (last) {
      // Torch evaluation is already white-POV — pass through.
      useEvalStore.getState().setEval(last.evaluation);
    }
    console.log('[Chessr] initial fetch_analysis applied:',
      result.moveAnalyses.length, 'moves analyzed,',
      'CAPS w/b:', result.caps.white.all + '/' + result.caps.black.all,
      'Elo w/b:', result.effectiveElo.white + '/' + result.effectiveElo.black);
    lastFailedHistoryHash = null;  // success — clear failure cache
  } catch (err) {
    console.warn('[Chessr] initial fetch_analysis failed on history (', history.length, 'moves):', history.join(' '), '\nerror:', err);
    lastFailedHistoryHash = histHash;  // remember to skip until history grows
    // Re-init torch if it died (timeout in waitForLinePrefix sets disposed).
    // lastFailedHistoryHash above ensures triggerInitialAnalysisIfSeeded
    // won't retry the same history on re-init — no crash loop.
    if (!torchAnalysisEngine?.ready) {
      buildLiveAnalysis().catch((e) => console.error('[Chessr] re-init failed:', e));
    }
  } finally {
    useAnalysisStore.getState().setAnalyzing(false);
    initialAnalysisInFlight = false;
  }
}

/** Convert a list emitted by extractInitialMoves (UCI strings, optionally
 *  prefixed with a single "pgn:<pgn>" sentinel for the PGN-fallback path)
 *  into a flat UCI list. */
function parseInitialMoves(raw: string[]): string[] {
  if (raw.length === 1 && raw[0].startsWith('pgn:')) {
    const pgn = raw[0].slice(4);
    try {
      // Chess is imported statically at the top of this file (see import
      // chunks above). Don't `require()` — the Vite/WXT bundle compiles
      // imports statically and `require` is undefined at runtime.
      const chess = new Chess();
      chess.loadPgn(pgn, { strict: false });
      const moves = chess.history({ verbose: true })
        .map((m: any) => `${m.from}${m.to}${m.promotion ?? ''}`);
      console.log('[Chessr] PGN parsed:', moves.length, 'moves from', pgn.length, 'chars');
      return moves;
    } catch (e) {
      console.warn('[Chessr] PGN seed parse failed:', e, '\nPGN:', pgn.slice(0, 200));
      return [];
    }
  }
  return raw;
}

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
    case 'maia3':     return new Maia3SuggestionEngine();
    case 'rodent':    return new RodentSuggestionEngine();
    case 'stockfish': return new StockfishSuggestionEngine();
    default:          return new SuggestionEngine(); // 'komodo'
  }
}

/** Parse the chessrForceServer localStorage flag into a Set of engine
 *  identifiers that should skip WASM. Accepts:
 *    '1' or 'all' → all engines
 *    'komodo'     → ['komodo']
 *    'komodo,stockfish' (any subset)
 *  Anything else / unset → empty Set (no override). */
function forceServerSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = localStorage.chessrForceServer;
  if (!raw) return new Set();
  if (raw === '1' || raw === 'all') return new Set(['komodo', 'maia3', 'rodent', 'stockfish', 'torch']);
  return new Set(raw.split(',').map((s: string) => s.trim()).filter(Boolean));
}

/** Sister flag: simulate a WASM init *failure* so the catch → fallback path
 *  is exercised (vs forceServerSet which just skips WASM). Same syntax. */
function forceFailSet(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  const raw = localStorage.chessrFailWasm;
  if (!raw) return new Set();
  if (raw === '1' || raw === 'all') return new Set(['komodo', 'maia3', 'rodent', 'stockfish', 'torch']);
  return new Set(raw.split(',').map((s: string) => s.trim()).filter(Boolean));
}

async function createEngine(id: EngineId): Promise<IEngine> {
  // Premium "server suggestions" mode — unless the load router has
  // currently fallen back to local (see serverEngineRouter).
  if (serverModeActive()) {
    const srv = new ServerEngine(id);
    await srv.init();
    recordEngineSwap({ slot: 'suggestion', engineId: id, mode: 'server', success: true, detail: 'forceServerEngine' });
    return srv;
  }

  // DEV affordance: skip WASM and force the server path. Toggle from
  // DevTools console:
  //   `localStorage.chessrForceServer = '1'`        → all engines
  //   `localStorage.chessrForceServer = 'komodo'`   → only Komodo
  //   `localStorage.chessrForceServer = 'maia3,stockfish'` → both
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
    // Per-engine init budget. Default 3s is fine for small engines (Komodo /
    // Stockfish). Rodent IV ships ~68 MB of preloaded books + an Asyncify-
    // wrapped UCI loop, which on first cold load on a busy chess.com tab
    // can take 15-25s just to fetch + parse + populate MEMFS. After the
    // first load the extension's static resources are cached by Chrome so
    // re-init is fast (<3s). 30s gives enough headroom for first-cold.
    // Maia 3 also has a 45 MB ONNX download — keep its existing internal
    // timeout untouched.
    const initBudget = id === 'rodent' ? 30_000 : WASM_INIT_TIMEOUT_MS;
    await Promise.race([
      wasmEng.init(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('wasm init timeout')), initBudget)),
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
function swapSuggestionEngine(id: EngineId, force = false): Promise<void> {
  const swap = (suggestionEngineSwapInFlight ?? Promise.resolve()).then(async () => {
    if (!force && suggestionEngine?.id === id && suggestionEngine.ready) return;

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
  if (suggestionEngine.id === 'maia3') {
    params = {
      fen,
      moves: [] as string[],
      multiPv: numArrows,
      eloSelf: engine.getMaiaEffectiveTargetElo(),
      eloOppo: engine.getMaiaEffectiveOppoElo(),
      variant: engine.maiaVariant,
      useBook: false,
    };
  } else if (suggestionEngine.id === 'rodent') {
    const effectiveElo = engine.getEffectiveElo();
    const limitStrength = premium ? engine.limitStrength : true;
    const search = premium
      ? { mode: engine.searchMode, nodes: engine.searchNodes, depth: engine.searchDepth, movetime: engine.searchMovetime }
      : FREE_DEFAULTS;
    params = {
      fen,
      moves: [] as string[],
      multiPv: numArrows,
      eloTarget: effectiveElo,
      limitStrength,
      imprecision: engine.imprecision,
      personality: engine.rodentPersonality,
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

  // Telemetry: log the search on the server. `source` tag tells the
  // dashboard whether the engine ran in-browser (wasm) or was proxied to
  // the server-side native binary (server fallback). E2E latency is the
  // time between this log_start and the matching log_end below — server
  // path adds one WS round-trip + queue wait + native engine compute.
  const engineLabel = suggestionEngine.id;
  const source = suggestionEngine instanceof ServerEngine ? 'server' : 'wasm';
  const extra = (() => {
    if (engineLabel === 'maia3') {
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
    // Rodent uses `eloTarget` as the field name (Komodo/Stockfish use
    // `targetElo`); fall back so the log line is always meaningful.
    const eloValue = (params as any).eloTarget ?? params.targetElo;
    return `source=${source} engine=${engineLabel} elo=${eloValue} mpv=${params.multiPv} limit=${params.limitStrength}${persoBit} search=${searchDesc}`;
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
    // Decorate suggestions with torch's native classification (best /
    // brilliant / great / etc.) — works for ANY suggestion engine, not
    // just torch, since classifyCandidate just plays the candidate as the
    // last move of a fetch_analysis run. Fire-and-forget; each result
    // updates the store independently. Skipped when:
    //   - rich engine isn't ready (server fallback / pre-init)
    //   - history doesn't replay to this fen (continuation game with
    //     unknown prefix → torch can't seed it from startpos)
    if (torchAnalysisEngine?.ready) {
      const history = useGameStore.getState().moveHistoryUci;
      if (historyMatchesFen(history, fen)) {
        for (const s of suggestions) {
          torchAnalysisEngine.classifyCandidate(history, s.move)
            .then((cls) => {
              if (cls && requestId === currentRequestId) {
                useSuggestionStore.getState().setClassification(requestId, s.move, cls);
              }
            })
            .catch((err) => {
              console.warn('[Chessr][torch] classifyCandidate failed for', s.move, err);
            });
        }
      }
    }
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

    // Auto Move: install hotkey listener + auto-play scheduler + pause toggle
    installHotkeyListener();
    installAutoPauseHotkey();
    installAutoPlayScheduler();
    // Mirror the live game state to chrome.storage so the Stream Mode
    // page (separate extension tab) can render the same board + arrows.
    installStreamSync();
    // Shrink suggestion arrows in real time when the user grabs a matching piece.
    installArrowDrag();

    // Stream Mode flag — kept in chrome.storage by the dedicated stream
    // tab. Cache the value synchronously so renderArrows() can no-op
    // when stream is open, and wipe any already-drawn arrows the moment
    // the streamer opens the tab. When stream closes, redraw the
    // current suggestions immediately so the host board doesn't stay
    // arrow-less until the engine produces the next batch.
    initStreamOpenCache();
    subscribeStreamOpen((open) => {
      if (open) {
        clearArrows();
        clearPersistentArrows();
        return;
      }
      const { suggestions } = useSuggestionStore.getState();
      if (suggestions.length === 0) return;
      const isFlipped = useGameStore.getState().playerColor === 'black';
      renderArrows(suggestions, isFlipped, true);
      redrawPersistentArrows();
    });

    // Mirror system-message widget state across this content script
    // and the dedicated Stream Mode tab via chrome.storage so the
    // streamer always sees notifications on whichever surface they're
    // looking at right now.
    installWidgetSync();

    // System-message broadcast — admin pushes a SystemMessage frame
    // through the WS, we drop it into the widget queue. Frame shape
    // matches serveur/src/routes/adminMessaging.ts on the producer side.
    onWsMessage((data) => {
      if (!data || typeof data !== 'object' || data.kind !== 'system_message') return;
      const msg = data.message as SystemMessage | undefined;
      if (!msg?.id || !msg.title || !msg.category) return;
      if (msg.category !== 'admin' && useSettingsStore.getState().disableInfoBanner) return;
      useWidgetStore.getState().push(msg);
    });
    // Suggestions are now served by the local SuggestionEngine; no WS
    // message dispatch needed here.

    // Render arrows when suggestions change (with animation). Async
    // classifyCandidate updates land here too — they only mutate
    // `class` on existing entries. Detect that and refresh badges
    // only, leaving arrow paths (and their draw animation) untouched.
    let lastSuggestionsKey: string | null = null;
    // Snapshot of last classified suggestions — used by playerJustMoved to
    // check if the played move was already classified (avoids waiting for torch).
    let lastSuggestionSnapshot: Array<{ move: string; class?: import('./content/lib/moveAnalysis').MoveClassification | null }> = [];
    useSuggestionStore.subscribe((state) => {
      if (state.suggestions.length === 0) {
        lastSuggestionsKey = null;
        clearArrows();
        return;
      }
      // Keep snapshot updated (including after classifyCandidate updates class).
      lastSuggestionSnapshot = state.suggestions.map((s) => ({ move: s.move, class: s.class }));
      const moveKey = state.suggestions.map((s) => s.move).join('|');
      const isFlipped = useGameStore.getState().playerColor === 'black';
      if (moveKey === lastSuggestionsKey) {
        // Same arrow set — only badges may have changed. Refresh in place.
        applyClassificationsToBoard(state.suggestions);
      } else {
        renderArrows(state.suggestions, isFlipped, true);
        lastSuggestionsKey = moveKey;
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

    // Server-suggestions load router — rebuilds the engine when the
    // server/local route flips (mode toggled, threshold crossed).
    startServerEngineRouter(() => {
      if (!useAuthStore.getState().user) return;
      swapSuggestionEngine(useEngineStore.getState().engineId, true).catch((err) => {
        console.error('[Chessr] server-route swap failed:', err);
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
        setOpponentMove(null);
        setMyLastMove(null);
        useAnalysisStore.getState().setCurrentOpponentMove(null);
        useAnalysisStore.getState().setCurrentMyLastMove(null);
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

      // Backfill last-move data when the extension loads into an in-progress game.
      // opponentJustMoved / playerJustMoved both require previousFen !== null so
      // they never fire on the first detection — reconstruct from history here.
      if (gameJustStarted && state.moveHistoryUci.length > 0) {
        const h = state.moveHistoryUci;
        // We're in the player's turn branch (playerColor === turn).
        // Last UCI in history = opponent's last move; second-to-last = ours.
        const lastUci = h[h.length - 1];
        if (lastUci) useAnalysisStore.getState().setCurrentOpponentMove({ uci: lastUci });
        const secondLastUci = h[h.length - 2];
        if (secondLastUci) useAnalysisStore.getState().setCurrentMyLastMove({ uci: secondLastUci });
      }

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
      // Gate on the PRE-transition flags (prev) instead of post (state)
      // so the move that ends the game (checkmate / resign-after-move /
      // timeout-on-move) still gets analyzed — chess.com bundles the
      // gameOver flag into the chessr:move event that delivers the
      // final FEN, so post-state gameOver is already true on that tick.
      // prev.isPlaying && !prev.gameOver excludes:
      //   - new-game starts (was idle, now playing)
      //   - spurious post-game FEN re-fires (was already gameOver)
      const playerJustMoved =
        previousFen !== null &&
        playerChar !== null &&
        sideToMove === playerChar &&
        previousFen !== state.fen &&
        prev.isPlaying &&
        !prev.gameOver;

      // Maintain moveHistoryUci on every detected move (player OR opponent),
      // before any analysis call — torch's fetch_analysis takes a full
      // history. Derive UCI from previous→current FEN.
      //
      // Two desync hazards we guard against:
      //   1. Takeback: state.fen goes BACKWARDS (chess.com /play/computer
      //      offers takebacks). uciFromFens returns null. We pop the
      //      tail of moveHistoryUci instead.
      //   2. Generic mismatch (uciFromFens returns null but state.fen
      //      didn't go backwards): non-adjacent positions. We can't
      //      reconstruct, so we resync — clear history; future fetch_analysis
      //      will fall back to UCI mode until next chessr:newGame.
      const aMoveHappened =
        previousFen !== null && previousFen !== state.fen && !!state.fen &&
        prev.isPlaying && !prev.gameOver;
      // Set when the transition was a 2-ply jump (opponent move + instantly
      // executed premove observed atomically). Holds the intermediate FEN
      // (position between the two moves of the pair).
      let premovePairFenMid: string | null = null;
      if (aMoveHappened) {
        const uci = uciFromFens(previousFen!, state.fen!);
        if (uci) {
          useGameStore.getState().pushUciMove(uci);
          console.log('[Chessr][hist] pushed ' + uci + ', historyLen now ' + useGameStore.getState().moveHistoryUci.length);
        } else {
          // Position is not reachable in 1 move from previousFen. Detect
          // takeback: if popping the last move from current history yields
          // a position that matches state.fen, treat as takeback.
          const hist = useGameStore.getState().moveHistoryUci;
          console.log('[Chessr][hist] uciFromFens NULL — prev=' + (previousFen?.slice(0, 30) ?? 'null') + ' state=' + (state.fen?.slice(0, 30) ?? 'null') + ' histLen=' + hist.length);
          if (hist.length > 0 && historyMatchesFen(hist.slice(0, -1), state.fen!)) {
            useGameStore.getState().setMoveHistoryUci(hist.slice(0, -1));
            console.log('[Chessr][hist] takeback detected — popped 1 move, history now', hist.length - 1);
          } else {
            // Premove: chess.com applies the opponent's move AND the queued
            // premove in the same synchronous cascade, so the FEN we observe
            // jumps 2 plies at once. Recover the pair instead of dropping
            // the history (which would kill torch's rich analysis path for
            // the rest of the game).
            const pair = uciPairFromFens(previousFen!, state.fen!);
            if (pair) {
              useGameStore.getState().pushUciMove(pair.moves[0]);
              useGameStore.getState().pushUciMove(pair.moves[1]);
              premovePairFenMid = pair.fenMid;
              console.log('[Chessr][hist] 2-ply jump (premove) — pushed ' + pair.moves.join('+') + ', historyLen now ' + useGameStore.getState().moveHistoryUci.length);
            } else if (hist.length > 0) {
              // Unreachable transition (chess960, sub-variant, page-rebind,
              // or chessr loaded the page in a weird state). Drop the
              // history and let UCI-mode handle it from here.
              useGameStore.getState().setMoveHistoryUci([]);
              console.log('[Chessr][hist] resync (history desynced) — cleared,', hist.length, 'moves dropped');
            }
          }
        }
      }

      // A pair ending with the PLAYER's move (the premove) must count as
      // "player just moved" — the normal detection misses it because the
      // side-to-move looks unchanged across the 2-ply jump. The side that
      // played the second move of the pair is fenMid's side-to-move.
      const pairEndedWithPlayerMove =
        premovePairFenMid !== null && premovePairFenMid.split(' ')[1] === playerChar;

      // Player moved → hide the opponent arrow (it's now our turn to move).
      if (playerJustMoved || pairEndedWithPlayerMove) {
        setOpponentMove(null);
        useAnalysisStore.getState().setCurrentOpponentMove(null);
        // Show "my last move" arrow immediately using any pre-existing classification
        // from the suggestion snapshot (classified by classifyCandidate before the move).
        const _playerUci = useGameStore.getState().moveHistoryUci.at(-1) ?? null;
        if (_playerUci) {
          const _preClass = lastSuggestionSnapshot.find((s) => s.move === _playerUci)?.class;
          // Always propagate to analysisStore so stream mode can show it independently.
          useAnalysisStore.getState().setCurrentMyLastMove({ uci: _playerUci, classification: _preClass ?? undefined });
          if (useSettingsStore.getState().showMyLastMove) {
            setMyLastMove({ uci: _playerUci, classification: _preClass ?? undefined });
          }
        }
      }

      if ((playerJustMoved || pairEndedWithPlayerMove) && (torchAnalysisEngine?.ready || torchUciEngine?.ready || analysisEngine?.ready)) {
        playerMoveCount++;
        // For a premove pair, the player's move starts from the intermediate
        // position (after the opponent's move of the pair), not previousFen.
        const fenBefore = premovePairFenMid ?? previousFen!;
        const moveNumber = parseMoveNumber(fenBefore);
        const fenAfter = state.fen!;
        const playerUci = useGameStore.getState().moveHistoryUci.at(-1) ?? null;
        const _diagHist = useGameStore.getState().moveHistoryUci;
        const _diagHistMatch = historyMatchesFen(_diagHist, fenAfter);
        console.log('[Chessr][analyze] playerJustMoved fired ' + JSON.stringify({
          moveNumber,
          historyLen: _diagHist.length,
          historyMatchesFen: _diagHistMatch,
          torchReady: !!torchAnalysisEngine?.ready,
          torchUciReady: !!torchUciEngine?.ready,
          willUseRich: !!(torchAnalysisEngine?.ready && _diagHistMatch),
        }));

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
                // Torch evaluation is already white-POV — pass through.
                useEvalStore.getState().setEval(last.evaluation);
                sendWs({ type: 'analysis_log_end', requestId: arid,
                         extra: `${last.classification} (torch)` });
                // Update "my last move" arrow with the real classification.
                if (playerUci) {
                  // Always propagate to analysisStore so stream mode can show it independently.
                  useAnalysisStore.getState().setCurrentMyLastMove({ uci: playerUci, classification: last.classification ?? undefined });
                  if (useSettingsStore.getState().showMyLastMove) {
                    setMyLastMove({ uci: playerUci, classification: last.classification ?? undefined });
                  }
                }
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
          // the dedicated torch UCI worker (does `position fen X` +
          // `go depth N`) and falls back to ServerAnalysisEngine if torch
          // isn't up at all.
          const liveBackend = torchUciEngine?.ready ? torchUciEngine : analysisEngine;
          if (liveBackend?.ready) {
            // playerJustMoved fired → side that played is the user. Side
            // to move BEFORE the move = sideToMove from fenBefore (the
            // intermediate FEN when the move came from a premove pair).
            const playedColor: 'white' | 'black' =
              fenBefore.split(' ')[1] === 'w' ? 'white' : 'black';
            analyzeLastMove(fenBefore, fenAfter, liveBackend)
              .then((result) => {
                useAnalysisStore.getState().addAnalysis({ ...result, moveNumber, color: playedColor });
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
      // See the playerJustMoved comment above on prev-vs-state gating —
      // same reasoning, lets the eval bar refresh on a game-ending
      // opponent move (mate / resign-after-move) before we go idle.
      const opponentJustMoved =
        previousFen !== null &&
        previousFen !== state.fen &&
        playerChar !== null &&
        fenSideToMove === playerChar &&
        prev.isPlaying &&
        !prev.gameOver &&
        !!state.fen;

      if (opponentJustMoved && (torchAnalysisEngine?.ready || torchUciEngine?.ready || analysisEngine?.ready)) {
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
              // Torch evaluation is already white-POV — pass through.
              useEvalStore.getState().setEval(last.evaluation);
            }
            // Set opponent move arrow — last move in history is the opponent's.
            const lastUci = history[history.length - 1];
            if (lastUci) {
              const oppMove = { uci: lastUci, classification: last?.classification };
              useAnalysisStore.getState().setCurrentOpponentMove(oppMove);
              setOpponentMove(oppMove);
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
          // UCI standard single-FEN eval — torch UCI worker preferred,
          // server SF fallback. Same path used in the playerJustMoved
          // else-branch.
          // Set opponent move arrow without classification (no torch analysis).
          const lastUci = history[history.length - 1];
          if (lastUci) {
            const oppMove = { uci: lastUci };
            useAnalysisStore.getState().setCurrentOpponentMove(oppMove);
            setOpponentMove(oppMove);
          }
          const evalBackend = torchUciEngine?.ready ? torchUciEngine : analysisEngine;
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
        case 'chessr:initialMoves':
          // chessr loaded mid-game (continuation game on chess.com).
          // Seed moveHistoryUci with the moves chess.com had in memory so
          // the next player move triggers a torch fetch_analysis that
          // replays correctly from startpos.
          //
          // GUARD: accept seed only if it brings MORE history than what
          // we currently have. Two race scenarios this handles:
          //   - User played during the 3s seed-poll: history=[user_move],
          //     seed=[m1...m12, user_move] (length 13) → replace.
          //   - Adapter polls multiple times: first poll gets 12 moves,
          //     a later one gets the same 12. We accept only the longer
          //     ones, and validate that the seed replays to current FEN.
          if (Array.isArray(data.moves) && data.moves.length > 0) {
            const currentHist = useGameStore.getState().moveHistoryUci;
            const seeded = parseInitialMoves(data.moves);
            const fen = useGameStore.getState().fen;
            if (seeded.length === 0) break;
            if (seeded.length <= currentHist.length) {
              console.log('[Chessr] seed ignored — current history (', currentHist.length, ') ≥ seed (', seeded.length, ')');
              break;
            }
            if (fen && !historyMatchesFen(seeded, fen)) {
              console.log('[Chessr] seed ignored — replay does not match current FEN');
              break;
            }
            useGameStore.getState().setMoveHistoryUci(seeded);
            console.log('[Chessr] seeded', seeded.length, 'initial moves into history (was', currentHist.length, ')');
            // After seeding, also reset previousFen so the next FEN-diff
            // observation doesn't pushUciMove a phantom move on top.
            previousFen = fen;
            // Reset moveAnalyses to force the initial analysis to fire
            // even if there were stale entries from a previous partial
            // analysis run (e.g. UCI-mode classifier results).
            useAnalysisStore.getState().reset();
            // Fire initial analysis if torch is already up. (If torch
            // becomes ready later, buildLiveAnalysis will trigger it.)
            triggerInitialAnalysisIfSeeded();
          }
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

          // Real-new-game branch — UNCANCELLABLE (outside the
          // newGameResetTimer setTimeout, which gets clearTimeout()'d by
          // chessr:mode on same-FEN). 5s cooldown absorbs the 3-4 newGame
          // bursts chess.com fires on a real game transition.
          //
          // We do two things here that the cancellable setTimeout below
          // cannot do reliably for real bot games:
          //   1. Full torch worker rebuild (torch has no working ucinewgame)
          //   2. Reset gameStore (clears moveHistoryUci) — without this,
          //      the previous game's history persists and torch's
          //      fetch_analysis falls back to UCI mode because
          //      historyMatchesFen returns false (verified in console logs
          //      after the first attempt of this fix).
          {
            const now = Date.now();
            const elapsed = now - lastTorchRebuildAt;
            if (elapsed >= TORCH_REBUILD_MIN_INTERVAL_MS) {
              lastTorchRebuildAt = now;
              console.log('[Chessr][torch] newGame → rebuild + game reset', {
                elapsedSinceLast: elapsed,
                richReady: !!torchAnalysisEngine?.ready,
                uciReady: !!torchUciEngine?.ready,
                prevHistoryLen: useGameStore.getState().moveHistoryUci.length,
              });
              // Preserve seeded move history if it already matches the
              // current FEN — this happens on a page reload mid-game
              // (continuation bot game). Without preservation, the history
              // is cleared and historyMatchesFen stays false for all live
              // moves, permanently locking torch into UCI fallback mode.
              const _histBeforeReset = useGameStore.getState().moveHistoryUci;
              const _fenBeforeReset = useGameStore.getState().fen;
              const _histMatchesFen = _histBeforeReset.length > 0 &&
                _fenBeforeReset != null &&
                historyMatchesFen(_histBeforeReset, _fenBeforeReset);
              // Reset the game store NOW (eager, not deferred) so the next
              // chessr:move event pushes onto an empty history.
              useGameStore.getState().reset();
              if (_histMatchesFen) {
                // Restore the history — it's valid for THIS game, not a
                // leftover from a previous one. Lets torch use the full
                // seeded history for the next live move.
                useGameStore.getState().setMoveHistoryUci(_histBeforeReset);
                console.log('[Chessr][torch] preserved', _histBeforeReset.length, 'moves through newGame (history matches current FEN)');
              }
              buildLiveAnalysis().catch((err) =>
                console.error('[Chessr] torch rebuild on newGame failed:', err),
              );
            } else {
              console.log('[Chessr][torch] newGame → skip rebuild (cooldown)', {
                elapsedSinceLast: elapsed,
                cooldownMs: TORCH_REBUILD_MIN_INTERVAL_MS,
              });
            }
          }

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
          console.log('[Chessr] chessr:ratings received', { playerRating: data.playerRating, opponentRating: data.opponentRating });
          if (data.playerRating) useEngineStore.getState().setUserElo(data.playerRating);
          if (data.opponentRating) useEngineStore.getState().setOpponentElo(data.opponentRating);
          // Forward to torch's rich worker — drives the rating-range
          // thresholds for the 11-class classifier and the effectiveElo
          // it reports. Without this update both stay calibrated for
          // the hardcoded 1500/1500 init defaults.
          if (torchAnalysisEngine?.ready) {
            const pc = useGameStore.getState().playerColor;
            const userElo = useEngineStore.getState().userElo;
            const oppElo = useEngineStore.getState().opponentElo;
            const whiteElo = pc === 'black' ? oppElo : userElo;
            const blackElo = pc === 'black' ? userElo : oppElo;
            console.log('[Chessr] forwarding ratings to torch', { pc, userElo, oppElo, whiteElo, blackElo, willSend: !!(whiteElo && blackElo) });
            if (whiteElo && blackElo) {
              torchAnalysisEngine.setRatings(whiteElo, blackElo).catch((err) =>
                console.warn('[Chessr][torch] setRatings failed:', err));
            }
          } else {
            console.log('[Chessr] torch not ready — ratings will be applied on init');
          }
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
