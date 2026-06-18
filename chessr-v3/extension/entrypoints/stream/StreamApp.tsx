/**
 * Stream Mode page — embeds the same chessr panel that opens on
 * platforms (chess.com / lichess / worldchess) when the user clicks
 * the trigger, alongside a self-contained chessboard with arrows + an
 * eval bar.
 *
 * Layout (desktop):
 *   ┌────────────────────────────────────────────────────────┐
 *   │  Stream Mode header (source · live indicator · stamp)  │
 *   ├──────────────────────┬────┬───────────────────────────┤
 *   │  EvalBar  +  Board   │ ⇔  │  Chessr panel (App)        │
 *   └──────────────────────┴────┴───────────────────────────┘
 *   The ⇔ is a drag handle — drag right to grow the board; when the
 *   board no longer leaves room for a side-by-side panel, the layout
 *   stacks vertically (board on top, panel below).
 *
 * On mobile / narrow viewport the layout starts stacked.
 */

import { useEffect, useRef, useState } from 'react';
import App from '../content/App';
import Chessboard, { ARROW_COLORS } from './Chessboard';
import EvalBar from './EvalBar';
import { installStreamHydration } from './streamHydration';
import { installWidgetSync } from '../content/lib/widgetSync';
import { useAuthStore } from '../content/stores/authStore';
import { useSettingsStore } from '../content/stores/settingsStore';
import { useAnalysisStore } from '../content/stores/analysisStore';

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

function useViewportWidth(): number {
  const [w, setW] = useState(typeof window === 'undefined' ? 1400 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

const PANEL_W = 400;

export default function StreamApp() {
  const state = useStreamState();
  const [, setTick] = useState(0);
  const viewportW = useViewportWidth();

  const evalBarW = 22;
  const evalGap = 8;
  const hPad = 48;
  const hGap = 20;

  // Maximum board size before the panel would be pushed off-screen.
  const maxDesktopBoard = Math.max(viewportW - PANEL_W - hGap - hPad - evalBarW - evalGap, 240);
  const naturalDesktopBoard = Math.min(Math.max(maxDesktopBoard, 320), 640);
  const naturalMobileBoard = Math.min(viewportW - 32 - evalBarW - evalGap, 520);

  // User-controlled board size via drag handle.
  const [userBoardSize, setUserBoardSize] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Clamp stored size when viewport changes.
  useEffect(() => {
    if (userBoardSize !== null && userBoardSize > maxDesktopBoard) {
      setUserBoardSize(maxDesktopBoard);
    }
  }, [maxDesktopBoard]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const next = Math.max(240, Math.min(dragRef.current.startW + delta, viewportW - PANEL_W - hGap - hPad - evalBarW - evalGap));
      setUserBoardSize(next);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [viewportW]);

  // Below 760 px the viewport is too narrow to fit board + panel side-by-side.
  const isMobileViewport = viewportW < PANEL_W + 360 + 60;
  const effectiveBoardSize = userBoardSize ?? naturalDesktopBoard;
  // Stack when viewport is narrow OR the user has grown the board so far
  // the panel would no longer fit beside it.
  const isStacked = isMobileViewport || (
    effectiveBoardSize + PANEL_W + hGap + hPad + evalBarW + evalGap > viewportW
  );
  const boardSize = isStacked ? naturalMobileBoard : effectiveBoardSize;

  const initialize = useAuthStore((s) => s.initialize);
  const arrowColors = useSettingsStore((s) => s.arrowColors);
  const opponentArrowColor = useSettingsStore((s) => s.opponentArrowColor);
  const showMyLastMove = useSettingsStore((s) => s.showMyLastMove);
  const opponentMove = useAnalysisStore((s) => s.currentOpponentMove);
  const myLastMove = useAnalysisStore((s) => s.currentMyLastMove);

  useEffect(() => {
    initialize();
    installStreamHydration();
    installWidgetSync();
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [initialize]);

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

  const boardColumn = (
    <div style={{
      display: 'flex',
      gap: evalGap,
      alignItems: 'flex-start',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <EvalBar
        evaluation={topSugg?.evaluation ?? null}
        mateScore={topSugg?.mateScore ?? null}
        turn={state?.turn ?? null}
        orientation={orientation}
        height={boardSize}
        width={isStacked ? 18 : evalBarW}
      />
      <Chessboard
        fen={state?.fen ?? null}
        orientation={orientation}
        arrows={(state?.suggestions ?? []).slice(0, 3).map((s, i) => ({
          from: s.move.slice(0, 2),
          to: s.move.slice(2, 4),
          color: arrowColors[i] ?? ARROW_COLORS[i] ?? '#71717a',
          rank: i,
          labels: s.labels,
          mateScore: s.mateScore,
          cls: s.class,
        }))}
        opponentMove={opponentMove}
        opponentArrowColor={opponentArrowColor}
        myLastMove={showMyLastMove ? myLastMove : null}
        size={boardSize}
      />
    </div>
  );

  return (
    <div style={{
      height: '100vh',
      maxWidth: 1400,
      margin: '0 auto',
      padding: isStacked ? '14px 16px' : '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: isStacked ? 17 : 20, fontWeight: 700, color: '#fff' }}>
          Chessr<span style={{ color: '#3b82f6' }}>.io</span>
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#a1a1aa' }}>
          STREAM MODE
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#71717a', textAlign: 'right' }}>
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

      {/* Body */}
      {isStacked ? (
        /* Stacked layout — board on top, panel below, scrollable */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {boardColumn}
          <div style={{ width: '100%', flex: '0 0 auto', minHeight: 480 }}>
            <App streamMode />
          </div>
        </div>
      ) : (
        /* Side-by-side layout with drag handle */
        <div style={{ display: 'flex', flexDirection: 'row', gap: 0, flex: 1, minHeight: 0, alignItems: 'stretch' }}>
          {boardColumn}

          {/* Drag handle */}
          <div
            onMouseDown={(e) => {
              dragRef.current = { startX: e.clientX, startW: boardSize };
              e.preventDefault();
            }}
            style={{
              width: hGap,
              flexShrink: 0,
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{
              width: 3,
              height: 40,
              borderRadius: 2,
              background: '#3f3f46',
              transition: 'background 0.15s',
            }} />
          </div>

          {/* Chessr panel */}
          <div style={{
            width: PANEL_W,
            flex: '0 0 auto',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <App streamMode />
          </div>
        </div>
      )}
    </div>
  );
}
