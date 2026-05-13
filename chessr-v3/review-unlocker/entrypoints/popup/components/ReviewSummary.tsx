import { useState } from 'react';

interface ReviewHeaders {
  White?: string | null;
  Black?: string | null;
  Result?: string | null;
}

interface Props {
  analysis: any;
  headers?: ReviewHeaders | null;
}

const ALL_CLS = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book',
  'inaccuracy', 'mistake', 'miss', 'blunder', 'forced',
] as const;
type Cls = typeof ALL_CLS[number];

const MINIMIZED_CLS: readonly Cls[] = ['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'blunder'];

const CLS_TEXT: Record<Cls, string> = {
  brilliant: '#22d3ee',
  great:     '#3b82f6',
  best:      '#22c55e',
  excellent: '#84cc16',
  good:      '#a3a3a3',
  book:      '#a78bfa',
  inaccuracy:'#fbbf24',
  mistake:   '#fb923c',
  miss:      '#f87171',
  blunder:   '#ef4444',
  forced:    '#64748b',
};

const BAR_FILL: Record<Cls, string> = CLS_TEXT;

/** Normalize chess.com classification names. Most come back lowercase
 *  already (best, book, excellent, good, inaccuracy, miss, mistake) but
 *  the "great" move is shipped as camelCase 'greatFind' — match it back
 *  to our 'great' bucket so the icon row renders the right count. */
function normalizeCls(raw: string | null | undefined): string {
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower === 'greatfind') return 'great';
  return lower;
}

function countCls(positions: any[], color: 'white' | 'black') {
  const c: Record<string, number> = {};
  for (const p of positions) {
    if (p.color !== color) continue;
    const k = normalizeCls(p.classificationName);
    if (!k) continue;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

/** Display accuracy / phase values to match chess.com's UI. chess.com
 *  TRUNCATES to 1 decimal (not rounds): an internal value of 84.95 shows
 *  as 84.9, not 85.0. Plain `toFixed(1)` would round and drift our popup
 *  off from the in-page chess.com numbers — confusing because the source
 *  data is the same. Floor to the nearest tenth before formatting. */
function fmt(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return (Math.floor(v * 10) / 10).toFixed(1);
}

function ClsIcon({ type }: { type: string }) {
  return <img src={`/icons/cls-${type}.svg`} width={20} height={20} alt={type} style={{ display: 'block' }} />;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function ReviewSummary({ analysis, headers }: Props) {
  const [expanded, setExpanded] = useState(false);

  const caps = analysis?.CAPS || {};
  const reportCard = analysis?.reportCard || {};
  const positions: any[] = analysis?.positions || [];

  const wC = caps.white || {};
  const bC = caps.black || {};
  const wElo = reportCard.white?.effectiveElo;
  const bElo = reportCard.black?.effectiveElo;
  const wCounts = countCls(positions, 'white');
  const bCounts = countCls(positions, 'black');
  const wTotal = Object.values(wCounts).reduce((a, b) => a + b, 0);

  const result = headers?.Result
    || analysis?.annotatedPgn?.match(/\[Result\s+"([^"]+)"\]/)?.[1]
    || '';
  const whiteWon = result === '1-0';
  const blackWon = result === '0-1';

  const whiteName = headers?.White
    || analysis?.annotatedPgn?.match(/\[White\s+"([^"]+)"\]/)?.[1]
    || 'White';
  const blackName = headers?.Black
    || analysis?.annotatedPgn?.match(/\[Black\s+"([^"]+)"\]/)?.[1]
    || 'Black';

  const phases: ReadonlyArray<readonly [string, 'gp0' | 'gp1' | 'gp2']> = [
    ['Opening',    'gp0'],
    ['Middlegame', 'gp1'],
    ['Endgame',    'gp2'],
  ];
  const visiblePhases = phases.filter(([, k]) => wC[k] != null || bC[k] != null);
  const visibleCls = expanded ? ALL_CLS : MINIMIZED_CLS;

  return (
    <div className="rv-card">
      {/* ─── Players header ─── */}
      <div className="rv-section">
        <div className="rv-grid">
          <span className="rv-name">{whiteName}</span>
          <span className="rv-center-label">Players</span>
          <span className="rv-name">{blackName}</span>
        </div>

        {(wElo != null || bElo != null) && (
          <div className="rv-grid">
            <div className="rv-badge">{wElo ?? '—'}</div>
            <span className="rv-center-label">Game Rating</span>
            <div className="rv-badge">{bElo ?? '—'}</div>
          </div>
        )}

        <div className="rv-grid">
          <div className={`rv-acc-box${whiteWon ? ' rv-acc-box--win' : ''}`}>{fmt(wC.all)}</div>
          <span className="rv-center-label">Accuracy</span>
          <div className={`rv-acc-box${blackWon ? ' rv-acc-box--win' : ''}`}>{fmt(bC.all)}</div>
        </div>

        {visiblePhases.length > 0 && (
          <div className="rv-phase-section">
            {visiblePhases.map(([label, key]) => (
              <div key={key} className="rv-grid rv-grid--sm">
                <span className="rv-phase-val">{fmt(wC[key])}</span>
                <span className="rv-center-label rv-center-label--sm">{label}</span>
                <span className="rv-phase-val">{fmt(bC[key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Classifications ─── */}
      <div className="rv-cls-section">
        {visibleCls.map((key) => {
          const color = CLS_TEXT[key] || '#888';
          const wN = wCounts[key] || 0;
          const bN = bCounts[key] || 0;
          return (
            <div key={key} className="rv-cls-row">
              <span className="rv-cls-num" style={{ color: wN ? color : 'rgba(255,255,255,0.08)' }}>{wN}</span>
              <div className="rv-cls-icon" data-tooltip={capitalize(key)} style={{ ['--tt-color' as any]: color }}>
                <ClsIcon type={key} />
              </div>
              <span className="rv-cls-num rv-cls-num--r" style={{ color: bN ? color : 'rgba(255,255,255,0.08)' }}>{bN}</span>
            </div>
          );
        })}

        <button className="rv-expand-btn" onClick={() => setExpanded((e) => !e)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.2s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ─── Move quality bar ─── */}
      <div className="rv-bar-section">
        <div className="rv-bar-head">
          <span className="rv-bar-title">Move quality</span>
          <span className="rv-bar-count">{wTotal} moves</span>
        </div>
        <div className="rv-bar">
          {ALL_CLS.map((key) => {
            const n = wCounts[key] || 0;
            if (n === 0) return null;
            return <div key={key} className="rv-bar-seg" style={{ flex: n, background: BAR_FILL[key] }} />;
          })}
        </div>
      </div>
    </div>
  );
}
