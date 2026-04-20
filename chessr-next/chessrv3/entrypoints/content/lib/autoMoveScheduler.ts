import { useAutoMoveStore, buildHumanizeDelays, weightedSample, randomInRangeBiased } from '../stores/autoMoveStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { executeAutoMove, executePremove, cancelPremoves } from './autoMove';

const PREMIUM_PLANS = ['premium', 'lifetime', 'beta', 'freetrial'];
function isPremiumPlan(plan: string | undefined): boolean {
  return PREMIUM_PLANS.includes(plan ?? '');
}

// ─── Hotkey listener ───

let hotkeyInstalled = false;
let lastHotkeyAt = 0;

export function installHotkeyListener(): void {
  if (hotkeyInstalled) return;
  hotkeyInstalled = true;

  window.addEventListener('keydown', (e) => {
    const s = useAutoMoveStore.getState();
    if (s.mode !== 'hotkey') return;

    // Skip if user is typing somewhere
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    // Debounce rapid repeats
    const now = Date.now();
    if (now - lastHotkeyAt < 150) return;

    const game = useGameStore.getState();
    if (!game.isPlaying || game.gameOver) return;
    if (!game.playerColor || game.playerColor !== game.turn) return;

    const suggestions = useSuggestionStore.getState().suggestions;
    if (suggestions.length === 0) return;

    // Match hotkey
    const key = e.key;
    let slot: 0 | 1 | 2 | null = null;
    if (keysMatch(key, s.hotkey1)) slot = 0;
    else if (keysMatch(key, s.hotkey2)) slot = 1;
    else if (keysMatch(key, s.hotkey3)) slot = 2;
    if (slot === null) return;
    if (slot >= suggestions.length) return;

    lastHotkeyAt = now;
    e.preventDefault();
    e.stopPropagation();

    const move = suggestions[slot].move;
    const humanize = buildHumanizeDelays(s);
    executeAutoMove(move, humanize);

    // Premove if modifier held
    if (isPremoveHeld(e, s.premoveKey)) {
      const pv = suggestions[slot].pv || [];
      if (pv.length >= 3) {
        const premoveMove = pv[2];
        const delay = randomInRangeBiased(s.premoveDelay);
        setTimeout(() => executePremove(premoveMove), delay);
      }
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

    // If in auto mode and auto-premove is on, schedule a premove during opponent's turn
    if (s.mode === 'auto' && s.autoPremove && state.turn !== null && state.playerColor !== null && state.turn !== state.playerColor) {
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
