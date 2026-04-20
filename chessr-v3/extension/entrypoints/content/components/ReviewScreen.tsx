import { useEffect, useState, useRef } from 'react';
import gsap from 'gsap';
import { useReviewStore } from '../stores/reviewStore';
import { useGameStore } from '../stores/gameStore';
import GameSummaryCard from './GameSummaryCard';
import { useGameMeta } from '../hooks/useGameMeta';
import './review-screen.css';

interface Props { gameId: string }

const MINIMIZED_CLS = ['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder'];
const ALL_CLS = ['brilliant', 'great', 'book', 'best', 'excellent', 'good', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const CLS_TEXT: Record<string, string> = {
  brilliant: '#22d3ee', great: '#749BBF', best: '#81B64C', excellent: '#81B64C',
  good: '#95b776', book: '#a78bfa', forced: '#96af8b', inaccuracy: '#fbbf24',
  mistake: '#fb923c', miss: '#FF7769', blunder: '#FA412D',
};
const BAR_FILL: Record<string, string> = {
  brilliant: '#26c2a3', great: '#749BBF', best: '#81B64C', excellent: '#81B64C',
  good: '#95b776', book: '#D5A47D', forced: '#96af8b', inaccuracy: '#F7C631',
  mistake: '#FFA459', miss: '#FF7769', blunder: '#FA412D',
};

function countCls(positions: any[], color: string): Record<string, number> {
  const c: Record<string, number> = {};
  for (const p of positions) {
    if (p.color !== color) continue;
    const k = p.classificationName?.toLowerCase() || '';
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

function fmt(v: number | null | undefined): string {
  return v != null ? v.toFixed(1) : '—';
}

function ClsIcon({ type }: { type: string }) {
  return <img src={browser.runtime.getURL(`/icons/cls-${type}.svg`)} width={20} height={20} alt={type} style={{ display: 'block' }} />;
}

function detectPlayerColor(whiteUsername?: string | null, blackUsername?: string | null): 'white' | 'black' {
  // 1. From gameStore (live games just played)
  const gc = useGameStore.getState().playerColor;
  if (gc) return gc;
  // 2. Match bottom player bar username with white/black
  try {
    const bottomName = document.querySelector('#board-layout-player-bottom .user-tagline-username')?.textContent?.trim();
    if (bottomName && whiteUsername && bottomName.toLowerCase() === whiteUsername.toLowerCase()) return 'white';
    if (bottomName && blackUsername && bottomName.toLowerCase() === blackUsername.toLowerCase()) return 'black';
  } catch {}
  // 3. Check if board is flipped
  try {
    const board = document.querySelector('wc-chess-board');
    if (board?.classList.contains('flipped') || (board as any)?.hasAttribute?.('flipped')) return 'black';
  } catch {}
  // 4. URL param
  if (window.location.href.includes('flip=true')) return 'black';
  return 'white';
}

// ─── Player avatar (fetches from Chess.com API) ───
const avatarCache = new Map<string, string | null>();

function useAvatar(username: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(username ? (avatarCache.get(username) ?? null) : null);

  useEffect(() => {
    if (!username) return;
    if (avatarCache.has(username)) { setUrl(avatarCache.get(username)!); return; }
    let cancelled = false;
    fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const av = data.avatar || null;
        avatarCache.set(username, av);
        setUrl(av);
      })
      .catch(() => { if (!cancelled) { avatarCache.set(username!, null); setUrl(null); } });
    return () => { cancelled = true; };
  }, [username]);

  return url;
}

function PlayerAvatar({ username, size = 40, won }: { username?: string | null; size?: number; won?: boolean }) {
  const url = useAvatar(username);

  return (
    <div style={{ padding: 2, borderRadius: 12, background: won ? '#22c55e' : 'transparent', flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {url ? (
          <img src={url} alt={username || ''} style={{ width: '100%', height: '100%', display: 'block' }} />
        ) : (
          <span style={{ fontSize: size * 0.4, fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>
            {(username || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

export function ReviewSummary({ analysis, playerColor, headers }: { analysis: any; playerColor: string; headers?: any }) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const opp = playerColor === 'white' ? 'black' : 'white';
  const caps = analysis.CAPS || {};
  const pC = caps[playerColor] || {};
  const oC = caps[opp] || {};
  const rc = analysis.reportCard || {};
  const pElo = rc[playerColor]?.effectiveElo;
  const oElo = rc[opp]?.effectiveElo;
  const positions = analysis.positions || [];
  const pCounts = countCls(positions, playerColor);
  const oCounts = countCls(positions, opp);
  const pTotal = Object.values(pCounts).reduce((a: number, b: number) => a + b, 0);
  const visibleCls = expanded ? ALL_CLS : MINIMIZED_CLS;

  // Extract result from headers or from annotatedPgn
  const result = headers?.Result
    || (analysis.annotatedPgn?.match(/\[Result\s+"([^"]+)"\]/)?.[1])
    || '';
  const pWon = (playerColor === 'white' && result === '1-0') || (playerColor === 'black' && result === '0-1');
  const oWon = (playerColor === 'white' && result === '0-1') || (playerColor === 'black' && result === '1-0');
  const whiteName = headers?.White
    || analysis.annotatedPgn?.match(/\[White\s+"([^"]+)"\]/)?.[1]
    || null;
  const blackName = headers?.Black
    || analysis.annotatedPgn?.match(/\[Black\s+"([^"]+)"\]/)?.[1]
    || null;
  const pName = playerColor === 'white' ? whiteName : blackName;
  const oName = playerColor === 'white' ? blackName : whiteName;

  // Animate card entrance
  useEffect(() => {
    if (!cardRef.current) return;
    gsap.from(cardRef.current, { opacity: 0, y: 16, duration: 0.5, ease: 'back.out(1.2)' });
    // Stagger inner rows
    const rows = cardRef.current.querySelectorAll('.rv-grid');
    if (rows.length) gsap.from(rows, { opacity: 0, y: 6, duration: 0.35, stagger: 0.04, delay: 0.15, ease: 'power2.out' });
  }, []);

  const phases = [['Opening', 'gp0'], ['Middlegame', 'gp1'], ['Endgame', 'gp2']] as const;
  const visiblePhases = phases.filter(([, k]) => pC[k] != null || oC[k] != null);

  return (
    <div className="rv-card" ref={cardRef}>
      {/* ─── Players header ─── */}
      <div className="rv-section">
        {/* Names */}
        <div className="rv-grid">
          <span className="rv-name">{pName || 'You'}</span>
          <span className="rv-center-label">Players</span>
          <span className="rv-name rv-right">{oName || 'Opponent'}</span>
        </div>

        {/* Avatars */}
        <div className="rv-grid">
          <PlayerAvatar username={pName} size={44} won={pWon} />
          <div />
          <PlayerAvatar username={oName} size={44} won={oWon} />
        </div>

        {/* Game Rating */}
        {(pElo || oElo) && (
          <div className="rv-grid">
            <div className="rv-badge">{pElo || '—'}</div>
            <span className="rv-center-label">Game Rating</span>
            <div className="rv-badge rv-right">{oElo || '—'}</div>
          </div>
        )}

        {/* Accuracy */}
        <div className="rv-grid">
          <div className="rv-acc-box" style={pWon ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' } : {}}>{fmt(pC.all)}</div>
          <span className="rv-center-label">Accuracy</span>
          <div className="rv-acc-box" style={oWon ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80' } : {}}>{fmt(oC.all)}</div>
        </div>

        {/* Phase accuracy */}
        {visiblePhases.length > 0 && (
          <div className="rv-phase-section">
            {visiblePhases.map(([label, key]) => (
              <div key={key} className="rv-grid rv-grid--sm">
                <span className="rv-phase-val">{fmt(pC[key])}</span>
                <span className="rv-center-label rv-center-label--sm">{label}</span>
                <span className="rv-phase-val rv-right">{fmt(oC[key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Classifications ─── */}
      <div className="rv-cls-section">
        {visibleCls.map((key) => {
          const color = CLS_TEXT[key] || '#888';
          const pN = pCounts[key] || 0;
          const oN = oCounts[key] || 0;
          return (
            <div key={key} className="rv-cls-row">
              <span className="rv-cls-num" style={{ color: pN ? color : 'rgba(255,255,255,0.08)' }}>{pN}</span>
              <div className="rv-cls-icon" data-tooltip={key.charAt(0).toUpperCase() + key.slice(1)} style={{ '--tt-color': color } as React.CSSProperties}>
                <ClsIcon type={key} />
              </div>
              <span className="rv-cls-num rv-cls-num--r" style={{ color: oN ? color : 'rgba(255,255,255,0.08)' }}>{oN}</span>
            </div>
          );
        })}

        <button className="rv-expand-btn" onClick={() => setExpanded(e => !e)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.2s' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ─── Move Quality Bar ─── */}
      <div className="rv-bar-section">
        <div className="rv-bar-head">
          <span className="rv-bar-title">Move Quality</span>
          <span className="rv-bar-count">{pTotal} moves</span>
        </div>
        <div className="rv-bar">
          {ALL_CLS.map((key) => {
            const n = pCounts[key] || 0;
            if (n === 0) return null;
            return <div key={key} className="rv-bar-seg" style={{ flex: n, background: BAR_FILL[key] }} />;
          })}
        </div>
      </div>
    </div>
  );
}

export default function ReviewScreen({ gameId }: Props) {
  const { loading, checking, progress, analysis, headers, error, checkCache, requestReview } = useReviewStore();
  const meta = useGameMeta(gameId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { checkCache(gameId); }, [gameId]);
  useEffect(() => {
    if (!ref.current) return;
    gsap.from(ref.current, { opacity: 0, y: 10, duration: 0.35, ease: 'power2.out' });
  }, []);

  const idle = !loading && !checking && !analysis && !error;

  return (
    <div className="review-screen" ref={ref}>
      {/* Banner */}
      <div className="rv-banner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /><line x1="12" y1="15" x2="12" y2="18" />
        </svg>
        <div>
          <span className="rv-banner-title">Chess.com Game Review</span>
          <span className="rv-banner-sub">Unlocked — no Diamond needed</span>
        </div>
      </div>

      {checking && <div className="review-loading"><span className="review-progress-text">Loading...</span></div>}

      {/* Card stays visible until analysis results replace it */}
      {!analysis && !checking && (
        <GameSummaryCard
          whiteName={meta.whiteName} blackName={meta.blackName}
          whiteRating={meta.whiteRating} blackRating={meta.blackRating}
          result={meta.result} playerColor={detectPlayerColor(meta.whiteName, meta.blackName)}
          timeControl={meta.timeControl}
          moveCount={meta.moveCount} termination={meta.termination}
        />
      )}

      {idle && (
        <button className="review-cta" onClick={() => requestReview(gameId)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          Analyze this game
        </button>
      )}

      {loading && (
        <div className="review-loading">
          <div className="review-progress-track"><div className="review-progress-fill" style={{ width: `${progress}%` }} /></div>
          <span className="review-progress-text">Analyzing... {progress}%</span>
        </div>
      )}

      {error === 'daily_limit' && (
        <button className="review-cta review-cta--upgrade" onClick={() => window.open('https://chessr.io/#pricing', '_blank')}>
          Upgrade to Premium
          <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.7, display: 'block', marginTop: 2 }}>Daily limit reached</span>
        </button>
      )}

      {error && error !== 'daily_limit' && (
        <>
          <div className="review-error">{`Error: ${error}`}</div>
          <button className="review-cta" onClick={() => window.open(`https://app.chessr.io/review/${gameId}`, '_blank')}>Review on Chessr</button>
        </>
      )}

      {analysis && (
        <>
          <ReviewSummary analysis={analysis} playerColor={detectPlayerColor(headers?.White, headers?.Black)} headers={headers} />
          <button className="review-cta review-cta--ghost" onClick={() => window.open(`https://app.chessr.io/review/${gameId}`, '_blank')}>See full game review</button>
        </>
      )}
    </div>
  );
}
