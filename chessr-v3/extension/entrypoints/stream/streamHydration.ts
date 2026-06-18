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
import { usePlatformStore, type Platform } from '../content/stores/platformStore';
import { useAnalysisStore } from '../content/stores/analysisStore';
import type { MoveClassification } from '../content/lib/moveAnalysis';
import type { Color } from '../content/stores/gameStore';

const STORAGE_KEY = 'chessr_stream_state';

interface StreamSnapshot {
  ts: number;
  source: string;
  /** Source-tab platform. Optional — older snapshots written before the
   *  field was added simply leave the platform store at its detected
   *  default, which is fine. */
  platform?: Platform;
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
    labels?: string[];
    class?: string;
  }>;
  engineId: string;
  plan: string | null;
  opponentMove?: { uci: string; classification?: string } | null;
  myLastMove?: { uci: string; classification?: string } | null;
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
  // Mirror the source tab's platform so platform-gated UI in the stream
  // tab (e.g. premove enabled only on chess.com) reflects the actual
  // source — without this it stays `null` because window.location is
  // chrome-extension://.
  if (snap.platform !== undefined) {
    usePlatformStore.setState({ platform: snap.platform });
  }
  if (snap.opponentMove !== undefined) {
    const opp = snap.opponentMove;
    useAnalysisStore.getState().setCurrentOpponentMove(
      opp ? { uci: opp.uci, classification: opp.classification as MoveClassification | undefined } : null,
    );
  }
  if (snap.myLastMove !== undefined) {
    const ml = snap.myLastMove;
    useAnalysisStore.getState().setCurrentMyLastMove(
      ml ? { uci: ml.uci, classification: ml.classification as MoveClassification | undefined } : null,
    );
  }
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
      labels: s.labels ?? [],
      class: s.class,
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
