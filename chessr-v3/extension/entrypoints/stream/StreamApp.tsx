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
import { installWidgetSync } from '../content/lib/widgetSync';
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
    labels?: string[];
    class?: string;
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

/** Track viewport width so we can switch to a stacked layout on narrow
 *  windows (≤900 px) — board on top, panel underneath. */
function useViewportWidth(): number {
  const [w, setW] = useState(typeof window === 'undefined' ? 1400 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

export default function StreamApp() {
  const state = useStreamState();
  const [, setTick] = useState(0);
  const viewportW = useViewportWidth();
  // Panel stays at the same fixed 400 px width as on the platforms;
  // the chessboard takes the remaining horizontal space and scales.
  const PANEL_W = 400;
  const isMobile = viewportW < PANEL_W + 360 + 60; // not enough room for board+panel side-by-side
  const horizontalGap = 20;
  const horizontalPadding = isMobile ? 32 : 48;
  const evalBarW = isMobile ? 18 : 22;
  const evalGap = 8;
  // On desktop the board fills the row minus the panel + paddings; on
  // mobile it spans the full available width minus a small breathing room.
  const desktopBoardSize = Math.min(
    Math.max(viewportW - PANEL_W - horizontalGap - horizontalPadding - evalBarW - evalGap, 320),
    640,
  );
  const mobileBoardSize = Math.min(viewportW - horizontalPadding - evalBarW - evalGap, 520);
  const boardSize = isMobile ? mobileBoardSize : desktopBoardSize;
  // Initial Supabase auth bootstrap (same as content scripts do at boot).
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
    installStreamHydration();
    // Mirror the system-message widget state with the host content
    // script (chess.com / lichess / worldchess) so admin nudges + login
    // triggers show up here when the streamer is on this tab.
    installWidgetSync();
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
      // Fill the viewport so the panel column has a real height to flex
      // against. `100vh` + flex column lets the body row grow vertically
      // while the panel / board children inherit a defined height.
      height: '100vh',
      maxWidth: 1400,
      margin: '0 auto',
      padding: isMobile ? '14px 16px' : '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* Header — single row on desktop, allowed to wrap on mobile */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700, color: '#fff' }}>
          Chessr<span style={{ color: '#3b82f6' }}>.io</span>
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#a1a1aa' }}>
          STREAM MODE
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 11, color: '#71717a',
          textAlign: 'right',
        }}>
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

      {/* Body — two columns on desktop, stacked on mobile. flex:1 + min-height:0
          lets the children actually fill the remaining vertical space. */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 14 : horizontalGap,
        flex: 1,
        minHeight: 0,
        alignItems: 'stretch',
      }}>
        {/* Board column — flex:1 grow on desktop so the board uses all
            the space the panel doesn't claim. Centered on mobile. */}
        <div style={{
          display: 'flex',
          gap: evalGap,
          flex: isMobile ? 'none' : 1,
          alignItems: 'flex-start',
          justifyContent: 'center',
          minWidth: 0,
        }}>
          <EvalBar
            evaluation={topSugg?.evaluation ?? null}
            mateScore={topSugg?.mateScore ?? null}
            turn={state?.turn ?? null}
            orientation={orientation}
            height={boardSize}
            width={evalBarW}
          />
          <Chessboard
            fen={state?.fen ?? null}
            orientation={orientation}
            arrows={(state?.suggestions ?? []).slice(0, 3).map((s, i) => ({
              from: s.move.slice(0, 2),
              to: s.move.slice(2, 4),
              color: ARROW_COLORS[i] ?? '#71717a',
              rank: i,
              labels: s.labels,
              mateScore: s.mateScore,
              cls: s.class,
            }))}
            size={boardSize}
          />
        </div>

        {/* Chessr panel column — fixed 400 px width to mirror the on-
            platform overlay; takes the full vertical space available
            in the row so all 4 tabs (Game/Engine/AutoMove/Settings)
            see the same layout users get on chess.com / lichess. */}
        <div style={{
          width: isMobile ? '100%' : PANEL_W,
          flex: isMobile ? 'none' : '0 0 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <App streamMode />
        </div>
      </div>
    </div>
  );
}
