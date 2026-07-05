import { useAutoMoveStore, buildHumanizeDelays, weightedSample, randomInRangeBiased } from '../stores/autoMoveStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { usePlatformStore, platformSupportsPremove } from '../stores/platformStore';
import { executeAutoMove, executePremove, cancelPremoves } from './autoMove';
import { setPremoveArrow, clearPremoveArrow } from './arrows';

import { isPremiumPlan } from './premium';

// ─── Hotkey trigger (shared between keyboard listener + on-screen buttons) ───

let lastHotkeyAt = 0;

/**
 * Trigger a hotkey move for `slot` (0/1/2). Returns true if a move was
 * actually fired, false if the gate (premium, mode, turn, debounce…)
 * blocked it. `withPremove` queues the PV continuation as a premove
 * when available — set true when the user held the premove key OR
 * clicked a button with the equivalent modifier active.
 *
 * Shared by the global keydown listener AND the on-screen click
 * buttons so behavior stays identical between input methods.
 */
export function triggerHotkeyMove(slot: 0 | 1 | 2, withPremove = false): boolean {
  const s = useAutoMoveStore.getState();
  if (s.mode !== 'hotkey') return false;
  if (!isPremiumPlan(useAuthStore.getState().plan)) return false;

  // Debounce rapid repeats — same window for keyboard + button paths.
  const now = Date.now();
  if (now - lastHotkeyAt < 150) return false;

  const game = useGameStore.getState();
  if (!game.isPlaying || game.gameOver) return false;
  if (!game.playerColor || game.playerColor !== game.turn) return false;

  const suggestions = useSuggestionStore.getState().suggestions;
  if (slot >= suggestions.length) return false;

  lastHotkeyAt = now;
  const move = suggestions[slot].move;
  const humanize = buildHumanizeDelays(s);
  executeAutoMove(move, humanize);

  // Premove is gated by platform — only chess.com is enabled today.
  // The settings UI also disables the modifier-key input on unsupported
  // platforms, but this is the runtime guard for the on-screen button
  // long-press path (which doesn't go through the settings UI).
  if (withPremove && platformSupportsPremove(usePlatformStore.getState().platform)) {
    const pv = suggestions[slot].pv || [];
    // pv[0] = our move just played, pv[1] = opponent's expected reply,
    // pv[2] = our follow-up — that's what we want to queue as a premove.
    if (pv.length >= 3) {
      schedulePremove(pv[2]);
    }
  }
  return true;
}

/**
 * Queue a premove for after the main move registers.
 *
 * The naive approach — `setTimeout(executeAutoMove, delay)` — races with
 * the humanize pipeline: when humanize total (pick + select + move
 * delays) > premove delay, the premove timer fires BEFORE the main move
 * has actually been played, and `executeAutoMove(pv[2])` plays pv[2] as
 * the primary move instead of queueing it as a premove. The "slow"
 * humanize preset (~700ms) collides head-on with the default 500–1000ms
 * premove delay every time.
 *
 * Fix: wait for `moveHistoryUci` to grow by 1 (main move registered),
 * THEN start the premove delay countdown. The subscription self-unsubs
 * on first match or on opponent-already-played; a 10s safety timeout
 * cleans up if neither condition triggers (e.g. game ended mid-flow).
 *
 * IMPORTANT — we call `executeAutoMove`, NOT `executePremove`. Chess.com's
 * `game.premoves.move()` API fails when called right after a regular
 * move (board is in a transitioning state); going through the regular
 * move path lets `wc-chess-board` detect "not your turn → premove" and
 * queue it correctly. Verified working in chessr-v2 hotkey path.
 */
function schedulePremove(premoveUci: string): void {
  const baseline = useGameStore.getState().moveHistoryUci.length;
  let scheduled = false;

  const fireAfterDelay = () => {
    const s = useAutoMoveStore.getState();
    const delay = randomInRangeBiased(s.premoveDelay);
    setTimeout(() => {
      const cur = useGameStore.getState();
      // Opponent already replied → premove pointless / would be wrong.
      if (cur.moveHistoryUci.length > baseline + 1) return;
      // Arrow appears only now — when the premove actually fires. It
      // clears when the turn comes back to the player (premove consumed
      // or invalidated) or on game end.
      setPremoveArrow(premoveUci);
      executeAutoMove(premoveUci, buildHumanizeDelays(useAutoMoveStore.getState()));
    }, delay);
  };

  const unsub = useGameStore.subscribe((state) => {
    const count = state.moveHistoryUci.length;
    if (count <= baseline) return;        // main move not yet registered
    if (scheduled) return;                // delay already running
    scheduled = true;
    unsub();
    if (count > baseline + 1) return;     // opponent already played, abort
    fireAfterDelay();
  });

  // Safety net — if the main move never registers (game cleanup,
  // disconnect, …) drop the subscription so we don't leak.
  setTimeout(() => { if (!scheduled) unsub(); }, 10_000);
}

// ─── Hotkey keyboard listener ───

let hotkeyInstalled = false;

/** Install the play/pause hotkey for auto mode. The listener is always
 *  bound but no-ops outside `mode === 'auto'`, so binding once at startup
 *  is fine and we don't have to track install/teardown across mode flips. */
let pauseHotkeyInstalled = false;
export function installAutoPauseHotkey(): void {
  if (pauseHotkeyInstalled) return;
  pauseHotkeyInstalled = true;

  window.addEventListener('keydown', (e) => {
    const s = useAutoMoveStore.getState();
    if (s.mode !== 'auto') return;
    if (!s.autoPlayPauseKey) return;

    // Don't intercept while the user is typing in chess.com chat,
    // search, etc. — same guard as the hotkey listener.
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    if (!keysMatch(e, s.autoPlayPauseKey)) return;

    // Toggle paused. preventDefault so Space doesn't also scroll the page.
    s.setAutoPaused(!s.autoPaused);
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

export function installHotkeyListener(): void {
  if (hotkeyInstalled) return;
  hotkeyInstalled = true;

  window.addEventListener('keydown', (e) => {
    const s = useAutoMoveStore.getState();
    if (s.mode !== 'hotkey') return;

    // Skip if user is typing somewhere
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    let slot: 0 | 1 | 2 | null = null;
    if (keysMatch(e, s.hotkey1)) slot = 0;
    else if (keysMatch(e, s.hotkey2)) slot = 1;
    else if (keysMatch(e, s.hotkey3)) slot = 2;
    if (slot === null) return;

    const fired = triggerHotkeyMove(slot, isPremoveHeld(e, s.premoveKey));
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

// Modifier-independent representation of the physical key. e.key is what
// the OS would type — Shift+1 = '!', AltGr+e on French layout = '€', etc.
// — which silently breaks the hotkey match the moment a user combines
// the digit hotkey with a Shift premove modifier (Windows users hit this
// constantly because they don't have ⌘ as an alternative). e.code is the
// physical key location and is stable across modifiers and keyboard
// layouts, so we use it for digits and letters where layout-independence
// matters most.
function canonicalKey(e: KeyboardEvent): string {
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code))   return e.code.slice(3).toLowerCase();
  // Map a few common non-printables to readable tokens so configs and the
  // UI ('Space', 'Enter', …) match what the matcher expects.
  if (e.code === 'Space')    return 'space';
  if (e.code === 'Enter')    return 'enter';
  if (e.code === 'Tab')      return 'tab';
  if (e.code === 'Escape')   return 'escape';
  if (e.code === 'Backspace') return 'backspace';
  return e.key.toLowerCase();
}

function keysMatch(e: KeyboardEvent, configured: string): boolean {
  if (!configured) return false;
  const c = configured.toLowerCase();
  // Match against both the canonical (modifier-stripped) form AND the
  // raw e.key so legacy configs that captured shifted symbols (e.g. '!')
  // keep working when the same Shift+1 chord is pressed.
  return canonicalKey(e) === c || e.key.toLowerCase() === c;
}

function isPremoveHeld(e: KeyboardEvent, key: string): boolean {
  switch (key.toLowerCase()) {
    case 'shift': return e.shiftKey;
    case 'control':
    case 'ctrl':  return e.ctrlKey;
    case 'alt':   return e.altKey;
    case 'meta':
    case 'cmd':   return e.metaKey;
    default:      return false;
  }
}

// ─── Auto-play scheduler ───

let pendingAutoTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingPremoveTimeout: ReturnType<typeof setTimeout> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let lastPlayedFen: string | null = null;

function startCountdown(totalMs: number) {
  const deadline = Date.now() + totalMs;
  useAutoMoveStore.getState().setAutoCountdown(totalMs);
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    const remaining = Math.max(0, deadline - Date.now());
    useAutoMoveStore.getState().setAutoCountdown(remaining);
    if (remaining <= 0 && countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 50);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function clearPendingAuto() {
  if (pendingAutoTimeout) { clearTimeout(pendingAutoTimeout); pendingAutoTimeout = null; }
  stopCountdown();
  useAutoMoveStore.getState().setAutoCountdown(null);
}

function clearPendingPremove() {
  if (pendingPremoveTimeout) { clearTimeout(pendingPremoveTimeout); pendingPremoveTimeout = null; }
}

export function installAutoPlayScheduler(): () => void {
  // Fires on suggestion change
  const unsubSuggestions = useSuggestionStore.subscribe((state, prev) => {
    if (state.suggestions === prev.suggestions) return;
    const s = useAutoMoveStore.getState();
    if (s.mode !== 'auto') return;
    trySchedule(state.suggestions);
  });

  // Fires on turn / game state change → cancel pending if no longer our turn
  const unsubGame = useGameStore.subscribe((state, prev) => {
    const s = useAutoMoveStore.getState();

    // Game over or stopped → wipe pending, reset dedup
    if (!state.isPlaying || state.gameOver) {
      clearPendingAuto();
      clearPendingPremove();
      clearPremoveArrow();
      lastPlayedFen = null;

      // Auto-rematch: trigger on game-over transition, online only, not paused.
      const justEnded = state.gameOver && !prev.gameOver;
      const isBotPage = /\/play\/computer|\/game\/computer\//.test(location.pathname);
      if (justEnded && s.mode === 'auto' && s.autoRematch && !s.autoPaused && !isBotPage) {
        setTimeout(() => {
          // Re-check pause state at fire time in case user paused during the 800ms delay
          if (!useAutoMoveStore.getState().autoPaused) {
            window.postMessage({ type: 'chessr:rematch' }, '*');
          }
        }, 800);
      }
      return;
    }

    // Turn flipped to opponent → cancel our pending move
    if (state.turn !== state.playerColor && pendingAutoTimeout) {
      clearPendingAuto();
    }

    // Turn came back to the player → any queued premove was consumed or
    // invalidated by the opponent's move; drop its arrow. Covers both the
    // hotkey and auto-premove paths.
    if (state.turn !== prev.turn && state.turn !== null && state.turn === state.playerColor) {
      clearPremoveArrow();
    }
    // A premove executing shows up as a 2-ply history jump with the turn
    // staying on the opponent (opponent move + premove applied atomically)
    // — the turn-based clear above misses that case.
    if (state.moveHistoryUci.length >= prev.moveHistoryUci.length + 2) {
      clearPremoveArrow();
    }

    // If in auto mode and auto-premove is on, schedule a premove during opponent's turn.
    // Premove is gated by platform — only chess.com is enabled today (see
    // platformSupportsPremove). On lichess / worldchess we skip this entirely.
    if (
      s.mode === 'auto' &&
      s.autoPremove &&
      platformSupportsPremove(usePlatformStore.getState().platform) &&
      state.turn !== null && state.playerColor !== null && state.turn !== state.playerColor
    ) {
      const suggestions = useSuggestionStore.getState().suggestions;
      if (suggestions.length > 0 && state.fen !== prev.fen) {
        // Cancel any existing premove and schedule a new one — the arrow
        // of the cancelled premove goes away with it.
        cancelPremoves();
        clearPendingPremove();
        clearPremoveArrow();
        const delay = randomInRangeBiased(s.premoveDelay);
        pendingPremoveTimeout = setTimeout(() => {
          executePremove(suggestions[0].move);
          // Arrow appears only when the premove actually fires.
          setPremoveArrow(suggestions[0].move);
          pendingPremoveTimeout = null;
        }, delay);
      }
    }
  });

  // Fires on autoPaused / mode change → (un)pausing should resume scheduling
  const unsubAuto = useAutoMoveStore.subscribe((state, prev) => {
    // Pause: cancel whatever's pending
    if (state.autoPaused && !prev.autoPaused) {
      clearPendingAuto();
      return;
    }
    // Unpause: clear the dedup and re-try scheduling with current state
    if (!state.autoPaused && prev.autoPaused && state.mode === 'auto') {
      lastPlayedFen = null;
      trySchedule(useSuggestionStore.getState().suggestions);
      return;
    }
    // Mode change (off → auto or hotkey → auto): try scheduling
    if (prev.mode !== state.mode && state.mode === 'auto') {
      lastPlayedFen = null;
      trySchedule(useSuggestionStore.getState().suggestions);
    }
    // Mode change away from auto: cancel pending
    if (prev.mode === 'auto' && state.mode !== 'auto') {
      clearPendingAuto();
    }
  });

  return () => { unsubSuggestions(); unsubGame(); unsubAuto(); };
}

function trySchedule(suggestions: { move: string; pv: string[]; labels?: string[] }[]): void {
  const s = useAutoMoveStore.getState();
  const game = useGameStore.getState();

  // Auto mode is premium-only. Stale state on a free user (cloud sync
  // from a previous premium session) shouldn't actually fire moves —
  // the UI mode-switch is also locked but this is the safety net.
  if (!isPremiumPlan(useAuthStore.getState().plan)) return;

  if (!game.isPlaying || game.gameOver) return;
  if (!game.playerColor || game.playerColor !== game.turn) return;
  if (!game.fen) return;
  if (suggestions.length === 0) return;
  if (lastPlayedFen === game.fen) return; // dedup
  if (s.autoPaused) return;                // paused — don't schedule

  lastPlayedFen = game.fen;
  clearPendingAuto();

  // Forcing-move priority:
  //   both #1 and #2 forcing → sample between them (drop #3)
  //   only #1 forcing        → always play #1
  //   otherwise              → normal weighted sample
  // Premium users can disable; free users always get the prioritization.
  const isForcing = (x?: { labels?: string[] }) => !!x?.labels?.some((l) => l === 'check' || l === 'mate');
  const premium = isPremiumPlan(useAuthStore.getState().plan);
  const prioritize = premium ? s.prioritizeForcing : true;
  const force0 = prioritize && isForcing(suggestions[0]);
  const force1 = prioritize && isForcing(suggestions[1]);

  let slot: number;
  if (force0 && force1) {
    slot = weightedSample(s.moveWeights, [true, true, false]);
  } else if (force0) {
    slot = 0;
  } else {
    const available = [0, 1, 2].map((i) => i < suggestions.length);
    slot = weightedSample(s.moveWeights, available);
  }

  const move = suggestions[slot]?.move;
  if (!move) return;

  const delay = randomInRangeBiased(s.autoPlayDelay);
  const humanize = buildHumanizeDelays(s);
  startCountdown(delay);

  pendingAutoTimeout = setTimeout(() => {
    const g = useGameStore.getState();
    const am = useAutoMoveStore.getState();
    stopCountdown();
    if (am.autoPaused) { am.setAutoCountdown(null); pendingAutoTimeout = null; return; }
    if (g.isPlaying && !g.gameOver && g.playerColor === g.turn) {
      executeAutoMove(move, humanize);
    }
    am.setAutoCountdown(null);
    pendingAutoTimeout = null;
  }, delay);
}
