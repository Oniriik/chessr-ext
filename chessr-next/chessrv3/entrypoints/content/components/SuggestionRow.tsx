import { useState, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore, type Plan } from '../stores/authStore';
import { renderPvArrows, restoreSuggestionArrows } from '../lib/arrows';
import {
  useExplanationStore,
  useExplanation,
  useIsExplanationLoading,
} from '../stores/explanationStore';
import type { Suggestion, MoveLabel } from '../stores/suggestionStore';
import './suggestion-row.css';

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const LABEL_CONFIG: Record<string, { text: string; color: string }> = {
  check:   { text: 'Check',   color: '#f97316' },
  mate:    { text: 'Mate',    color: '#a855f7' },
  capture: { text: 'Capture', color: '#64748b' },
};

const PROMO_PIECES: Record<string, string> = {
  q: 'Q', r: 'R', b: 'B', n: 'N',
};

function isPremium(plan: Plan): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';
}

interface Props {
  suggestion: Suggestion;
  index: number;
  color: string;
  fen: string;
  compact?: boolean;
  hotkey?: string;
}

export default function SuggestionRow({ suggestion, index, color, fen, compact, hotkey }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const plan = useAuthStore((s) => s.plan);
  const playerColor = useGameStore((s) => s.playerColor);

  const showPv = useCallback(() => {
    if (suggestion.pv.length < 2 || previewing) return;
    setPreviewing(true);
    const isFlipped = playerColor === 'black';
    renderPvArrows(suggestion.pv, isFlipped, playerColor === 'white');
  }, [suggestion.pv, playerColor, previewing]);

  const hidePv = useCallback(() => {
    if (!previewing) return;
    setPreviewing(false);
    restoreSuggestionArrows();
  }, [previewing]);
  const premium = isPremium(plan);

  const explanation = useExplanation(fen, suggestion.move);
  const isLoading = useIsExplanationLoading(fen, suggestion.move);
  const error = useExplanationStore((s) => s.error);
  const fetchExplanation = useExplanationStore((s) => s.fetchExplanation);

  const labels = (suggestion.labels || []).map((l) => {
    if (l.startsWith('promotion:')) {
      const piece = l.split(':')[1];
      return { text: `Promo ${PROMO_PIECES[piece] || '♛'}`, color: '#a855f7' };
    }
    const cfg = LABEL_CONFIG[l];
    if (!cfg) return { text: l, color: '#6b7280' };
    const text = l === 'mate' && suggestion.mateScore !== null
      ? Math.abs(suggestion.mateScore) === 1 ? 'Mate' : `Mate in ${Math.abs(suggestion.mateScore)}`
      : cfg.text;
    return { ...cfg, text };
  });

  const handleExplain = () => {
    if (!premium) return;

    if (expanded && explanation) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    if (!explanation) {
      fetchExplanation({
        fen,
        moveSan: suggestion.move,
        moveUci: suggestion.move,
        evaluation: suggestion.evaluation,
        mateScore: suggestion.mateScore,
        winRate: suggestion.winRate,
        pvSan: suggestion.pv,
        playerColor: playerColor || 'white',
      });
    }
  };

  return (
    <div className="srow" style={{ borderLeftColor: color, background: `${color}15` }}>
      <div className="srow-main">
        <div className="srow-left">
          {hotkey ? (
            <span className="srow-hotkey" style={{ color, background: hexToRgba(color, 0.2) }}>
              {hotkey}
            </span>
          ) : (
            <span className="srow-rank" style={{ color, fontVariantNumeric: 'tabular-nums' }}>#{index + 1}</span>
          )}
          <span className="srow-move">{suggestion.move}</span>
          {labels.map((l, i) => (
            <span key={i} className="srow-label" style={{ background: hexToRgba(l.color, 0.15), color: l.color }}>
              {l.text}
            </span>
          ))}
        </div>
        <div className="srow-right">
          {compact && suggestion.pv.length > 1 && (
            <button
              className={`srow-pv-eye ${previewing ? 'srow-pv-eye--active' : ''}`}
              onMouseEnter={showPv}
              onMouseLeave={hidePv}
              onClick={() => previewing ? hidePv() : showPv()}
              title="Preview continuation"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
          <span className="srow-eval">
            {suggestion.mateScore !== null
              ? `M${Math.abs(suggestion.mateScore)}`
              : `${suggestion.evaluation > 0 ? '+' : ''}${(suggestion.evaluation / 100).toFixed(1)}`}
          </span>
          <span className="srow-wr">{suggestion.winRate.toFixed(0)}%</span>
          {!compact && (
            <button
              className={`srow-explain ${expanded ? 'srow-explain--active' : ''} ${!premium ? 'srow-explain--locked' : ''}`}
              onClick={handleExplain}
              title={!premium ? 'Premium feature' : expanded ? 'Hide explanation' : 'Explain this move'}
            >
              {isLoading ? (
                <span className="srow-explain-spinner" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {suggestion.pv.length > 1 && !compact && (() => {
        const pvMoves = suggestion.pv.slice(1);
        const MAX_PV_DISPLAY = 8;
        const visibleMoves = previewing ? pvMoves : pvMoves.slice(0, MAX_PV_DISPLAY);
        const hiddenCount = pvMoves.length - visibleMoves.length;
        return (
        <div className="srow-pv">
          <div className="srow-pv-moves">
            {visibleMoves.map((move, i) => (
              <span key={i} className={`srow-pv-move ${i % 2 === 0 ? 'srow-pv-move--dark' : 'srow-pv-move--light'}`}>{move}</span>
            ))}
            {hiddenCount > 0 && (
              <span className="srow-pv-more">+{hiddenCount}</span>
            )}
          </div>
          <button
            className={`srow-pv-eye ${previewing ? 'srow-pv-eye--active' : ''}`}
            onMouseEnter={showPv}
            onMouseLeave={hidePv}
            onClick={() => previewing ? hidePv() : showPv()}
            title="Preview continuation on board"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        );
      })()}

      {expanded && (
        <div className="srow-explanation">
          {isLoading ? (
            <span className="srow-explanation-loading">Thinking...</span>
          ) : explanation ? (
            <p className="srow-explanation-text">
              {explanation.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                part.startsWith('**') && part.endsWith('**')
                  ? <span key={i} className="srow-explanation-bold">{part.slice(2, -2)}</span>
                  : part
              )}
            </p>
          ) : error ? (
            <p className="srow-explanation-error">{error}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
