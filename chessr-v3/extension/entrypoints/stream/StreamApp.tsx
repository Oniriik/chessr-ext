/**
 * Stream Mode page.
 *
 * Subscribes to the live game state mirrored by streamSync.ts in the
 * content scripts. Displays a chessboard, eval bar, top suggestions,
 * and a sidebar with engine/plan info — designed for OBS capture or
 * second-screen display while the streamer plays in another tab.
 *
 * Layout (1280×720 capture-friendly):
 *   [ sidebar | (evalBar + board) | suggestion / state cards ]
 */

import { useEffect, useState } from 'react';
import Chessboard, { ARROW_COLORS } from './Chessboard';
import EvalBar from './EvalBar';

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

const ENGINE_LABEL: Record<string, string> = {
  komodo: 'Komodo',
  stockfish: 'Stockfish',
  maia2: 'Maia 2',
  maia3: 'Maia 3',
};

const PLAN_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  lifetime:  { label: 'Lifetime',   bg: 'rgba(192, 132, 252, 0.18)', fg: '#c084fc' },
  beta:      { label: 'Beta',       bg: 'rgba(165, 180, 252, 0.18)', fg: '#a5b4fc' },
  premium:   { label: 'Premium',    bg: 'rgba(96, 165, 250, 0.18)',  fg: '#60a5fa' },
  freetrial: { label: 'Free trial', bg: 'rgba(248, 113, 113, 0.18)', fg: '#f87171' },
  free:      { label: 'Free',       bg: 'rgba(251, 191, 36, 0.18)',  fg: '#fbbf24' },
};

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

function fmtEval(s: StreamSnapshot['suggestions'][number]): string {
  if (s.mateScore !== null) return `M${Math.abs(s.mateScore)}`;
  const sign = s.evaluation > 0 ? '+' : '';
  return `${sign}${s.evaluation.toFixed(2)}`;
}

export default function StreamApp() {
  const state = useStreamState();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Tell the content scripts to hide their on-page panel while this tab
  // is mounted. Cleanup on unmount (BFCache restore, navigation away,
  // tab close fires beforeunload). Background's tabs.onRemoved handler
  // is the safety net for hard tab kills.
  useEffect(() => {
    browser.storage.local.set({
      [STREAM_OPEN_KEY]: { value: true, ts: Date.now() },
    });
    const cleanup = () => {
      browser.storage.local.set({
        [STREAM_OPEN_KEY]: { value: false, ts: Date.now() },
      });
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
      display: 'flex',
      minHeight: '100vh',
      maxWidth: 1280,
      margin: '0 auto',
      padding: 24,
      gap: 24,
      boxSizing: 'border-box',
    }}>
      <Sidebar state={state} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <Header state={state} stale={!!stale} />
        {!state ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Eval bar + board */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <EvalBar
                evaluation={topSugg?.evaluation ?? null}
                mateScore={topSugg?.mateScore ?? null}
                turn={state.turn}
                orientation={orientation}
                height={480}
              />
              <Chessboard
                fen={state.fen}
                orientation={orientation}
                arrows={state.suggestions.slice(0, 3).map((s, i) => ({
                  from: s.move.slice(0, 2),
                  to: s.move.slice(2, 4),
                  color: ARROW_COLORS[i] ?? '#71717a',
                  rank: i,
                }))}
                size={480}
              />
            </div>

            {/* Cards */}
            <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Card label="Status">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>
                    Playing as <strong style={{ color: '#3b82f6' }}>{state.playerColor ?? '—'}</strong>
                  </span>
                  <span style={{ fontSize: 12, color: '#a1a1aa' }}>
                    {state.gameOver
                      ? 'Game over'
                      : state.turn === state.playerColor
                      ? 'Your move'
                      : 'Opponent to move'}
                  </span>
                </div>
              </Card>

              <Card label={`Suggestions · ${ENGINE_LABEL[state.engineId] ?? state.engineId}`}>
                {state.suggestions.length === 0 ? (
                  <span style={{ color: '#71717a', fontSize: 12 }}>—</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {state.suggestions.map((s, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex', gap: 10, alignItems: 'baseline',
                          padding: '6px 8px', borderRadius: 6,
                          background: 'rgba(255,255,255,0.02)',
                          borderLeft: `3px solid ${ARROW_COLORS[i] ?? '#71717a'}`,
                        }}
                      >
                        <span style={{ width: 18, color: '#71717a', fontSize: 11 }}>#{i + 1}</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14, color: '#fff' }}>
                          {s.move}
                        </span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#a1a1aa' }}>
                          {fmtEval(s)}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#52525b', fontFamily: 'ui-monospace, monospace' }}>
                          d{s.depth}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card label="FEN">
                <code style={{ fontSize: 11, color: '#a1a1aa', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' }}>
                  {state.fen ?? '—'}
                </code>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Sidebar({ state }: { state: StreamSnapshot | null }) {
  const planBadge = state?.plan ? PLAN_BADGE[state.plan] ?? null : null;
  return (
    <div style={{
      width: 200, flexShrink: 0,
      display: 'flex', flexDirection: 'column', gap: 16,
      padding: 16,
      background: '#12131a',
      border: '1px solid #2a2b3d',
      borderRadius: 12,
      height: 'fit-content',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
          Chessr<span style={{ color: '#3b82f6' }}>.io</span>
        </span>
      </div>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#71717a' }}>
        STREAM MODE
      </span>

      {planBadge && (
        <div>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: '#71717a', textTransform: 'uppercase' }}>
            Plan
          </span>
          <div style={{
            marginTop: 4,
            display: 'inline-block',
            padding: '4px 10px',
            borderRadius: 999,
            background: planBadge.bg,
            color: planBadge.fg,
            fontSize: 11, fontWeight: 700,
          }}>
            {planBadge.label}
          </div>
        </div>
      )}

      <div>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: '#71717a', textTransform: 'uppercase' }}>
          Engine
        </span>
        <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: '#fff' }}>
          {state ? ENGINE_LABEL[state.engineId] ?? state.engineId : '—'}
        </div>
      </div>

      <div>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: '#71717a', textTransform: 'uppercase' }}>
          Source
        </span>
        <div style={{ marginTop: 4, fontSize: 12, color: '#a1a1aa', wordBreak: 'break-all' }}>
          {state?.source ?? '—'}
        </div>
      </div>

      <div style={{ marginTop: 'auto', fontSize: 10, color: '#52525b', lineHeight: 1.5 }}>
        Configure engine, ELO, and other settings from the chessr.io panel inside your game tab.
      </div>
    </div>
  );
}

function Header({ state, stale }: { state: StreamSnapshot | null; stale: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 16, fontWeight: 600, color: '#a1a1aa' }}>
        {state?.gameOver ? '⏹  Game over' : state ? '🟢 Live' : '⚪ Idle'}
      </span>
      {state && (
        <span style={{ fontSize: 11, color: stale ? '#f87171' : '#71717a' }}>
          updated {ago(state.ts)}{stale ? ' · stale' : ''}
        </span>
      )}
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#12131a',
      border: '1px solid #2a2b3d',
      borderRadius: 10,
      padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: '#71717a', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ fontSize: 13, color: '#e4e4e7' }}>{children}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '60px 20px', color: '#a1a1aa', minHeight: 480,
    }}>
      <span style={{ fontSize: 60 }}>🎬</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Stream Mode is ready</span>
      <span style={{ fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
        Open a chess game on Chess.com, Lichess, or World Chess in another tab.
        Live state, suggestions, and arrows will appear here automatically.
      </span>
    </div>
  );
}
