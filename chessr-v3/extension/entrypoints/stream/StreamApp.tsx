/**
 * Stream Mode page — embeds the same chessr panel that opens on
 * platforms (chess.com / lichess / worldchess) when the user clicks
 * the trigger, alongside a self-contained chessboard with arrows + an
 * eval bar.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────┐
 *   │  Stream Mode header (source · live indicator · timestamp)│
 *   ├──────────────────────┬────────────────────────────────┤
 *   │  EvalBar  +  Board   │   Chessr panel (App with        │
 *   │                      │    streamMode=true) — Game/     │
 *   │                      │    Engine/AutoMove/Settings    │
 *   └──────────────────────┴────────────────────────────────┘
 *
 * The panel reads game data from streamHydration (synced from content
 * scripts via browser.storage.local). Settings / engine / auth use
 * their normal init paths — Supabase auth + cloud settings work the
 * same in extension-page contexts as in content scripts.
 */

import { useEffect, useState } from 'react';
import App from '../content/App';
import Chessboard, { ARROW_COLORS } from './Chessboard';
import EvalBar from './EvalBar';
import { installStreamHydration } from './streamHydration';
import { useAuthStore } from '../content/stores/authStore';

const STORAGE_KEY = 'chessr_stream_state';
const STREAM_OPEN_KEY = 'chessr_stream_open';

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

function useStreamState(): StreamSnapshot | null {
  const [state, setState] = useState<StreamSnapshot | null>(null);
  useEffect(() => {
    browser.storage.local.get(STORAGE_KEY).then((res) => {
      const snap = (res as Record<string, unknown>)[STORAGE_KEY];
      if (snap) setState(snap as StreamSnapshot);
    });
    const onChanged = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      const change = changes[STORAGE_KEY];
      if (change?.newValue) setState(change.newValue as StreamSnapshot);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);
  return state;
}

function ago(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.round(sec / 60)}m ago`;
}

export default function StreamApp() {
  const state = useStreamState();
  const [, setTick] = useState(0);
  // Initial Supabase auth bootstrap (same as content scripts do at boot).
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
    installStreamHydration();
    // Keep the "ago" timestamp fresh.
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [initialize]);

  // Tell content scripts to hide their on-page panel while we're mounted.
  useEffect(() => {
    browser.storage.local.set({ [STREAM_OPEN_KEY]: { value: true, ts: Date.now() } });
    const cleanup = () => {
      browser.storage.local.set({ [STREAM_OPEN_KEY]: { value: false, ts: Date.now() } });
    };
    window.addEventListener('beforeunload', cleanup);
    return () => {
      cleanup();
      window.removeEventListener('beforeunload', cleanup);
    };
  }, []);

  const stale = state && Date.now() - state.ts > 30_000;
  const orientation: 'white' | 'black' = state?.playerColor ?? 'white';
  const topSugg = state?.suggestions[0] ?? null;

  return (
    <div style={{
      minHeight: '100vh',
      maxWidth: 1400,
      margin: '0 auto',
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
          Chessr<span style={{ color: '#3b82f6' }}>.io</span>
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#a1a1aa' }}>
          STREAM MODE
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#71717a' }}>
          {state ? (
            <>
              <span style={{ color: state.gameOver ? '#71717a' : '#22c55e' }}>
                {state.gameOver ? '⏹ Game over' : '🟢 Live'}
              </span>
              {' · '}
              {state.source}
              {' · '}
              <span style={{ color: stale ? '#f87171' : '#71717a' }}>
                {ago(state.ts)}{stale ? ' · stale' : ''}
              </span>
            </>
          ) : (
            <span>⚪ Waiting for a game in another tab</span>
          )}
        </span>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'flex', gap: 24, flex: 1, alignItems: 'flex-start' }}>
        {/* Board column */}
        <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
          <EvalBar
            evaluation={topSugg?.evaluation ?? null}
            mateScore={topSugg?.mateScore ?? null}
            turn={state?.turn ?? null}
            orientation={orientation}
            height={520}
          />
          <Chessboard
            fen={state?.fen ?? null}
            orientation={orientation}
            arrows={(state?.suggestions ?? []).slice(0, 3).map((s, i) => ({
              from: s.move.slice(0, 2),
              to: s.move.slice(2, 4),
              color: ARROW_COLORS[i] ?? '#71717a',
              rank: i,
            }))}
            size={520}
          />
        </div>

        {/* Chessr panel column — full Game/Engine/AutoMove/Settings UI */}
        <div style={{
          flex: 1, minWidth: 380, height: 600,
          display: 'flex', flexDirection: 'column',
        }}>
          <App streamMode />
        </div>
      </div>
    </div>
  );
}
