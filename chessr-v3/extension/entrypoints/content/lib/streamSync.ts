/**
 * Stream Mode sync — content script writes a serialised snapshot of
 * the live game state to `browser.storage.local` so the stream-mode
 * page (extension page, separate tab) can render the same board +
 * suggestions.
 *
 * Why storage, not a runtime port: simpler, survives content-script
 * reload, no need for a relay in the background, works the same on
 * Chrome + Firefox via WXT's `browser` polyfill. Rate-limited to
 * ~120 writes/min by Chrome but our update cadence (one snapshot per
 * board change) is well under that even in storm mode.
 *
 * The stream page subscribes via `browser.storage.onChanged`.
 */

import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useEngineStore } from '../stores/engineStore';
import { useAuthStore } from '../stores/authStore';
import { usePlatformStore, type Platform } from '../stores/platformStore';

export interface StreamSnapshot {
  /** ms since epoch — lets the stream page detect stale snapshots when
   *  the source tab gets backgrounded and storage stops updating. */
  ts: number;
  /** Hostname of the source tab (chess.com / lichess.org / worldchess.com). */
  source: string;
  /** Platform detected by the source content script. Propagated so the
   *  stream tab (whose own location is chrome-extension://) doesn't fall
   *  through to `null` and disable platform-gated UI like premove. */
  platform: Platform;
  fen: string | null;
  playerColor: 'white' | 'black' | null;
  turn: 'white' | 'black' | null;
  gameOver: boolean;
  /** Top suggestions — same shape as suggestionStore but truncated to 3.
   *  `labels` and `class` are propagated so the stream-mode board can
   *  render mate/capture/check/promotion + classification (Best /
   *  Brilliant / …) badges on each arrow's destination square. */
  suggestions: Array<{
    move: string;
    pv: string[];
    evaluation: number;
    mateScore: number | null;
    depth: number;
    winRate: number;
    labels?: string[];
    class?: string;
  }>;
  engineId: string;
  plan: string | null;
}

const STORAGE_KEY = 'chessr_stream_state';

/** Build a snapshot from the live stores. */
function buildSnapshot(): StreamSnapshot {
  const game = useGameStore.getState();
  const suggestions = useSuggestionStore.getState().suggestions;
  const engine = useEngineStore.getState();
  const auth = useAuthStore.getState();
  return {
    ts: Date.now(),
    source: location.hostname,
    platform: usePlatformStore.getState().platform,
    fen: game.fen,
    playerColor: game.playerColor,
    turn: game.turn,
    gameOver: game.gameOver,
    suggestions: suggestions.slice(0, 3).map((s) => ({
      move: s.move,
      pv: s.pv,
      evaluation: s.evaluation,
      mateScore: s.mateScore,
      depth: s.depth,
      winRate: s.winRate,
      labels: s.labels,
      class: s.class,
    })),
    engineId: engine.engineId,
    plan: auth.plan ?? null,
  };
}

let writePending = false;
let lastWrittenAt = 0;
const MIN_WRITE_INTERVAL_MS = 100; // coalesce rapid back-to-back changes

/** Write the current state to storage. Coalesces bursts (e.g. when the
 *  game store updates fen + turn + gameOver in three quick set() calls)
 *  so we don't hammer chrome.storage with sub-100ms writes. */
function flush(): void {
  if (writePending) return;
  const since = Date.now() - lastWrittenAt;
  const wait = Math.max(0, MIN_WRITE_INTERVAL_MS - since);
  writePending = true;
  setTimeout(() => {
    writePending = false;
    lastWrittenAt = Date.now();
    const snapshot = buildSnapshot();
    browser.storage.local.set({ [STORAGE_KEY]: snapshot }).catch((err) => {
      console.warn('[Chessr][stream] storage.set failed:', err);
    });
  }, wait);
}

/** Subscribe the streamSync to all relevant store changes. Idempotent —
 *  multiple installs collapse to one listener per store. */
let installed = false;
export function installStreamSync(): void {
  if (installed) return;
  installed = true;
  // Snapshot immediately so the stream page has *something* on first load.
  flush();
  useGameStore.subscribe(() => flush());
  useSuggestionStore.subscribe(() => flush());
  useEngineStore.subscribe(() => flush());
  useAuthStore.subscribe(() => flush());
}

export const STREAM_STORAGE_KEY = STORAGE_KEY;
