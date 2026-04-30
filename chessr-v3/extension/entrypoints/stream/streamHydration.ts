/**
 * Hydrate the per-context Zustand stores from streamSync storage.
 *
 * The stream page runs in its own JS context — its `useGameStore` /
 * `useSuggestionStore` instances are SEPARATE from the content script's.
 * The content script writes a serialised snapshot of game state into
 * `browser.storage.local` (see content/lib/streamSync.ts); this module
 * subscribes the stream page's stores to those snapshots so the panel
 * reads consistent live data.
 *
 * Settings / engine / auth use their normal init paths (Supabase + cloud
 * sync) — they're shared via Supabase row, not via streamSync.
 */

import { useGameStore } from '../content/stores/gameStore';
import { useSuggestionStore } from '../content/stores/suggestionStore';
import type { Color } from '../content/stores/gameStore';

const STORAGE_KEY = 'chessr_stream_state';

interface StreamSnapshot {
  ts: number;
  source: string;
  fen: string | null;
  playerColor: 'white' | 'black' | null;
  turn: 'white' | 'black' | null;
  gameOver: boolean;
  suggestions: Array<{
    move: string;
    pv: string[];
    evaluation: number;
    mateScore: number | null;
    depth: number;
    winRate: number;
  }>;
  engineId: string;
  plan: string | null;
}

/** Apply a snapshot to the local stores. Treats missing fields as
 *  "no update" so partial snapshots don't wipe valid state. */
function apply(snap: StreamSnapshot): void {
  useGameStore.setState({
    fen: snap.fen,
    playerColor: snap.playerColor as Color,
    turn: snap.turn as Color,
    gameOver: snap.gameOver,
    isPlaying: snap.fen !== null && !snap.gameOver,
  });
  // Suggestions: provide a synthetic requestId so any subscribers that
  // gate on requestId match still pass.
  const requestId = `stream-${snap.ts}`;
  useSuggestionStore.getState().setSuggestions(
    snap.suggestions.map((s) => ({
      move: s.move,
      pv: s.pv,
      evaluation: s.evaluation,
      mateScore: s.mateScore,
      depth: s.depth,
      winRate: s.winRate,
      // Fields not part of the stream sync — fill with zeros so the
      // suggestion type is satisfied.
      multipv: 0,
      drawRate: 0,
      lossRate: 0,
    })) as never,
    requestId,
  );
}

let installed = false;

export function installStreamHydration(): void {
  if (installed) return;
  installed = true;

  // Initial read.
  browser.storage.local.get(STORAGE_KEY).then((res) => {
    const snap = (res as Record<string, StreamSnapshot | undefined>)[STORAGE_KEY];
    if (snap) apply(snap);
  });

  // Subscribe to updates.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (change?.newValue) apply(change.newValue as StreamSnapshot);
  });
}
