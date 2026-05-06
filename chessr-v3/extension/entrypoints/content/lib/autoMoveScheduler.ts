import { useAutoMoveStore, buildHumanizeDelays, weightedSample, randomInRangeBiased } from '../stores/autoMoveStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { usePlatformStore, platformSupportsPremove } from '../stores/platformStore';
import { executeAutoMove, executePremove, cancelPremoves } from './autoMove';

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

export function installHotkeyListener(): void {
  if (hotkeyInstalled) return;
  hotkeyInstalled = true;

  window.addEventListener('keydown', (e) => {
    const s = useAutoMoveStore.getState();
    if (s.mode !== 'hotkey') return;

    // Skip if user is typing somewhere
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const key = e.key;
    let slot: 0 | 1 | 2 | null = null;
    if (keysMatch(key, s.hotkey1)) slot = 0;
    else if (keysMatch(key, s.hotkey2)) slot = 1;
    else if (keysMatch(key, s.hotkey3)) slot = 2;
    if (slot === null) return;

    const fired = triggerHotkeyMove(slot, isPremoveHeld(e, s.premoveKey));
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

function keysMatch(pressed: string, configured: string): boolean {
  if (!configured) return false;
  return pressed.toLowerCase() === configured.toLowerCase();
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
        // Cancel any existing premove and schedule a new one
        cancelPremoves();
        clearPendingPremove();
        const delay = randomInRangeBiased(s.premoveDelay);
        pendingPremoveTimeout = setTimeout(() => {
          executePremove(suggestions[0].move);
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
