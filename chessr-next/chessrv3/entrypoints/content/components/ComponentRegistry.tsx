import { useMemo, useRef, useEffect } from 'react';
import gsap from 'gsap';
import PerformanceCard from './PerformanceCard';
import SuggestionRow from './SuggestionRow';
import Toggle from './Toggle';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { useEngineStore, type Personality, PERSONALITY_INFO, getAmbitionLabel } from '../stores/engineStore';
import { useAccuracy, useAccuracyTrend, useMoveAnalyses, computeClassificationCounts } from '../stores/analysisStore';
import { useAutoMoveStore, formatCountdown } from '../stores/autoMoveStore';
import { useLayoutStore } from '../stores/layoutStore';
import { animationGate } from '../stores/animationStore';
import Slider, { lerpColor } from './Slider';
import { fCard, fRow, fLabel, fSelect, fAutoBtn } from './widgetPrimitives';
import { getGameStatus, getGameOutcome } from './GameScreen';

export const COMPONENT_REGISTRY: Record<string, { label: string }> = {
  gameinfo: { label: 'Game Info' },
  performance: { label: 'Performance' },
  suggestions: { label: 'Suggestions' },
  elo: { label: 'Target ELO' },
  search: { label: 'Max search depth' },
  force: { label: 'Force search depth' },
  personality: { label: 'Personality' },
  ambition: { label: 'Ambition' },
  variety: { label: 'Variety' },
};

function isPremium(plan: string): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';
}

function FloatingSuggestions() {
  const { suggestions, loading } = useSuggestionStore();
  const { arrowColors, numArrows } = useSettingsStore();
  const { fen, playerColor, turn } = useGameStore();
  const isMyTurn = playerColor && turn && playerColor === turn;
  const depthReached = suggestions.length > 0 ? suggestions[0]?.depth : null;

  return (
    <div style={fCard}>
      {suggestions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {suggestions.map((s, i) => (
            <SuggestionRow key={s.move} suggestion={s} index={i} color={arrowColors[i]} fen={fen || ''} compact />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Array.from({ length: numArrows }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 8px 8px 12px', borderRadius: 8, borderLeft: `3px solid ${arrowColors[i]}20`, background: `${arrowColors[i]}05`, gap: 8, minHeight: 32, boxSizing: 'border-box' }}>
              <div style={{ width: 32, height: 8, borderRadius: 4, background: `${arrowColors[i]}10` }} />
              <div style={{ width: 24, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.03)', marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <span
          title={depthReached != null ? 'Search depth reached' : 'Searching…'}
          style={{
            fontSize: 9, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
            padding: '1px 5px', borderRadius: 3,
            color: depthReached != null ? '#71717a' : 'rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.04)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {depthReached != null ? `depth ${depthReached}` : 'depth —'}
        </span>
      </div>
    </div>
  );
}

function FloatingElo() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const effectiveElo = engine.getEffectiveElo();
  const autoActive = engine.targetEloAuto;
  const maxElo = premium ? (engine.limitStrength ? 2500 : 3500) : 2000;
  const searchPinned = useLayoutStore((s) => s.pinned.includes('search'));
  const forcePinned = useLayoutStore((s) => s.pinned.includes('force'));
  return (
    <div style={fCard}>
      <div style={fRow}>
        <span style={fLabel}>Target ELO</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e4e4e7', fontVariantNumeric: 'tabular-nums' }}>{autoActive ? effectiveElo : engine.targetEloManual}</span>
          <button onClick={() => engine.setTargetEloAuto(!autoActive)} style={fAutoBtn(autoActive)}>Auto</button>
        </div>
      </div>
      <Slider
        min={400} max={maxElo} step={50}
        value={autoActive ? effectiveElo : engine.targetEloManual}
        onChange={(v) => {
          if (autoActive) engine.setTargetEloAuto(false);
          engine.setTargetEloManual(v);
          if (v < 2500 && !engine.limitStrength) engine.setLimitStrength(true);
        }}
        trackColor={!engine.limitStrength ? 'linear-gradient(90deg, #22c55e, #3b82f6, #ef4444)' : 'linear-gradient(90deg, #22c55e, #3b82f6)'}
        thumbColor="#22c55e"
        thumbColorEnd={!engine.limitStrength ? '#ef4444' : '#3b82f6'}
      />
      {autoActive && (
        <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
          {engine.opponentElo > 0
            ? `Opponent ${engine.opponentElo} + ${engine.autoEloBoost} boost`
            : `${engine.userElo} + ${engine.autoEloBoost} boost`}
        </span>
      )}
      {searchPinned && <SearchSubmodule />}
      {forcePinned && <ForceSubmodule />}
    </div>
  );
}

function SearchSubmodule() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={fRow}>
        <span style={{ ...fLabel, fontSize: 7 }}>Max search depth</span>
        <select
          value={engine.searchMode}
          disabled={!premium}
          onChange={(e) => engine.setSearchMode(e.target.value as 'nodes' | 'depth' | 'movetime')}
          style={fSelect}
        >
          <option value="nodes">Nodes</option>
          <option value="depth">Depth</option>
          <option value="movetime">Move Time</option>
        </select>
      </div>
      <div style={fRow}>
        {engine.searchMode === 'nodes' && (
          <>
            <Slider min={100000} max={5000000} step={100000} value={engine.searchNodes} onChange={engine.setSearchNodes} disabled={!premium}
              trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 30%, #a855f7 60%, #ef4444 100%)"
              thumbColorFn={(pct) => pct < 30 ? '#3b82f6' : pct < 60 ? lerpColor('#3b82f6', '#a855f7', (pct - 30) / 30) : lerpColor('#a855f7', '#ef4444', (pct - 60) / 40)} />
            <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>{(engine.searchNodes / 1000000) >= 1 ? `${(engine.searchNodes / 1000000).toFixed(1)}M` : `${(engine.searchNodes / 1000).toFixed(0)}k`}</span>
          </>
        )}
        {engine.searchMode === 'depth' && (
          <>
            <Slider min={1} max={30} step={1} value={engine.searchDepth} onChange={engine.setSearchDepth} disabled={!premium}
              trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 40%, #a855f7 65%, #ef4444 100%)"
              thumbColorFn={(pct) => pct < 40 ? '#3b82f6' : pct < 65 ? lerpColor('#3b82f6', '#a855f7', (pct - 40) / 25) : lerpColor('#a855f7', '#ef4444', (pct - 65) / 35)} />
            <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>{engine.searchDepth}</span>
          </>
        )}
        {engine.searchMode === 'movetime' && (
          <>
            <Slider min={500} max={5000} step={100} value={engine.searchMovetime} onChange={engine.setSearchMovetime} disabled={!premium}
              trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 25%, #a855f7 55%, #ef4444 100%)"
              thumbColorFn={(pct) => pct < 25 ? '#3b82f6' : pct < 55 ? lerpColor('#3b82f6', '#a855f7', (pct - 25) / 30) : lerpColor('#a855f7', '#ef4444', (pct - 55) / 45)} />
            <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>{(engine.searchMovetime / 1000).toFixed(1)}s</span>
          </>
        )}
      </div>
    </div>
  );
}

function FloatingSearch() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  return (
    <div style={fCard}>
      <div style={fRow}>
        <span style={fLabel}>Max search depth</span>
        <select
          value={engine.searchMode}
          disabled={!premium}
          onChange={(e) => engine.setSearchMode(e.target.value as 'nodes' | 'depth' | 'movetime')}
          style={fSelect}
        >
          <option value="nodes">Nodes</option>
          <option value="depth">Depth</option>
          <option value="movetime">Move Time</option>
        </select>
      </div>
      <div style={{ ...fRow, marginTop: 4 }}>
        {engine.searchMode === 'nodes' && (
          <>
            <Slider min={100000} max={5000000} step={100000} value={engine.searchNodes} onChange={engine.setSearchNodes} disabled={!premium}
              trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 30%, #a855f7 60%, #ef4444 100%)"
              thumbColorFn={(pct) => pct < 30 ? '#3b82f6' : pct < 60 ? lerpColor('#3b82f6', '#a855f7', (pct - 30) / 30) : lerpColor('#a855f7', '#ef4444', (pct - 60) / 40)} />
            <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>{(engine.searchNodes / 1000000) >= 1 ? `${(engine.searchNodes / 1000000).toFixed(1)}M` : `${(engine.searchNodes / 1000).toFixed(0)}k`}</span>
          </>
        )}
        {engine.searchMode === 'depth' && (
          <>
            <Slider min={1} max={30} step={1} value={engine.searchDepth} onChange={engine.setSearchDepth} disabled={!premium}
              trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 40%, #a855f7 65%, #ef4444 100%)"
              thumbColorFn={(pct) => pct < 40 ? '#3b82f6' : pct < 65 ? lerpColor('#3b82f6', '#a855f7', (pct - 40) / 25) : lerpColor('#a855f7', '#ef4444', (pct - 65) / 35)} />
            <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>{engine.searchDepth}</span>
          </>
        )}
        {engine.searchMode === 'movetime' && (
          <>
            <Slider min={500} max={5000} step={100} value={engine.searchMovetime} onChange={engine.setSearchMovetime} disabled={!premium}
              trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 25%, #a855f7 55%, #ef4444 100%)"
              thumbColorFn={(pct) => pct < 25 ? '#3b82f6' : pct < 55 ? lerpColor('#3b82f6', '#a855f7', (pct - 25) / 30) : lerpColor('#a855f7', '#ef4444', (pct - 55) / 45)} />
            <span style={{ fontSize: 9, color: '#71717a', flexShrink: 0 }}>{(engine.searchMovetime / 1000).toFixed(1)}s</span>
          </>
        )}
      </div>
    </div>
  );
}

function ForceSubmodule() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={fRow}>
        <span style={{ ...fLabel, fontSize: 7 }}>Force search depth</span>
        <Toggle
          checked={!engine.limitStrength && premium}
          onChange={(v) => { if (premium) engine.setLimitStrength(!v); }}
          disabled={!premium}
        />
      </div>
    </div>
  );
}

function FloatingForce() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  return (
    <div style={{ ...fCard, ...fRow }}>
      <span style={fLabel}>Force search depth</span>
      <Toggle
        checked={!engine.limitStrength && premium}
        onChange={(v) => { if (premium) engine.setLimitStrength(!v); }}
        disabled={!premium}
      />
    </div>
  );
}

function FloatingPersonality() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const personalities = engine.getPersonalities(plan);
  return (
    <div style={{ ...fCard, ...fRow }}>
      <span style={fLabel}>Personality</span>
      <select value={engine.personality} onChange={(e) => engine.setPersonality(e.target.value as Personality)} style={fSelect}>
        {personalities.map((p) => (<option key={p} value={p}>{PERSONALITY_INFO[p].label}</option>))}
      </select>
    </div>
  );
}

function FloatingAmbition() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const info = getAmbitionLabel(engine.ambition);
  return (
    <div style={fCard}>
      <div style={fRow}>
        <span style={fLabel}>Ambition</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: engine.ambitionAuto ? '#71717a' : '#c084fc' }}>{info.label} ({engine.ambitionAuto ? 0 : engine.ambition})</span>
          <button onClick={() => premium && engine.setAmbitionAuto(!engine.ambitionAuto)} style={{ ...fAutoBtn(engine.ambitionAuto), cursor: premium ? 'pointer' : 'not-allowed', opacity: premium ? 1 : 0.4 }}>Auto</button>
        </div>
      </div>
      <Slider
        min={-100} max={100} step={5}
        value={engine.ambitionAuto ? 0 : engine.ambition}
        onChange={engine.setAmbition}
        disabled={engine.ambitionAuto}
        trackColor="linear-gradient(90deg, #ef4444, #a855f7, #3b82f6, #a855f7, #ef4444)" thumbColorFn={(pct) => lerpColor('#3b82f6', '#ef4444', Math.abs(pct - 50) / 50)}
      />
    </div>
  );
}

function FloatingVariety() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  return (
    <div style={fCard}>
      <div style={fRow}>
        <span style={fLabel}>Variety</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#e4e4e7' }}>{engine.variety}</span>
      </div>
      <Slider
        min={0} max={10} step={1}
        value={engine.variety}
        onChange={engine.setVariety}
        disabled={!premium}
        trackColor="linear-gradient(90deg, #3b82f6, #f59e0b)" thumbColor="#3b82f6" thumbColorEnd="#f59e0b"
      />
    </div>
  );
}

function FloatingGameInfo() {
  const { playerColor, turn, gameOver, gameEnd, result } = useGameStore();
  const autoMode = useAutoMoveStore((s) => s.mode);
  const autoPaused = useAutoMoveStore((s) => s.autoPaused);
  const autoCountdownMs = useAutoMoveStore((s) => s.autoCountdownMs);
  const setAutoPaused = useAutoMoveStore((s) => s.setAutoPaused);
  const isMyTurn = !!(playerColor && turn && playerColor === turn);
  const isAuto = autoMode === 'auto' && !gameOver;

  let statusText: string;
  let statusColor: string;
  let statusBg: string;

  if (gameOver) {
    statusText = getGameStatus(gameEnd, result, playerColor, turn);
    const outcome = getGameOutcome(gameEnd, result, playerColor, turn);
    statusColor = outcome === 'win' ? '#22c55e' : outcome === 'draw' ? '#fbbf24' : '#f87171';
    statusBg = outcome === 'win' ? 'rgba(34,197,94,0.15)' : outcome === 'draw' ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)';
  } else if (isAuto) {
    statusText = autoPaused
      ? 'Paused'
      : isMyTurn
        ? (autoCountdownMs != null ? `Playing in ${formatCountdown(autoCountdownMs)}` : 'Playing…')
        : "Opponent's turn";
    statusColor = '#c084fc';
    statusBg = 'rgba(168,85,247,0.15)';
  } else {
    statusText = isMyTurn ? 'Your turn' : "Opponent's turn";
    statusColor = isMyTurn ? '#3b82f6' : '#71717a';
    statusBg = isMyTurn ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.04)';
  }

  return (
    <div style={{ ...fCard, ...fRow }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 14, height: 14, borderRadius: 4, background: playerColor === 'white' ? '#fff' : '#27272a', border: '1px solid rgba(255,255,255,0.1)' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#e4e4e7' }}>{playerColor === 'white' ? 'White' : 'Black'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: statusBg }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 9, fontWeight: 500, color: statusColor }}>{statusText}</span>
        </div>
        {isAuto && (
          <button
            type="button"
            onClick={() => setAutoPaused(!autoPaused)}
            title={autoPaused ? 'Resume auto-play' : 'Pause auto-play'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, padding: 0,
              border: 'none', cursor: 'pointer',
              borderRadius: 4,
              background: 'rgba(168,85,247,0.15)',
              color: '#c084fc',
            }}
          >
            {autoPaused ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

const CLS_CONFIG = [
  { key: 'best', label: 'Best', color: '#22c55e' },
  { key: 'excellent', label: 'Exce', color: '#6ee7b7' },
  { key: 'good', label: 'Good', color: '#94a3b8' },
  { key: 'inaccuracy', label: 'Inacc', color: '#fbbf24' },
  { key: 'mistake', label: 'Miss', color: '#fb923c' },
  { key: 'blunder', label: 'Blund', color: '#f87171' },
] as const;

function CompactPerformance() {
  const accuracy = useAccuracy();
  const trend = useAccuracyTrend();
  const moveAnalyses = useMoveAnalyses();
  const counts = useMemo(() => computeClassificationCounts(moveAnalyses), [moveAnalyses]);
  const idle = moveAnalyses.length === 0;

  const numberRef = useRef<HTMLSpanElement>(null);
  const displayedValue = useRef({ val: accuracy });

  useEffect(() => {
    if (idle || !numberRef.current) return;
    const shouldAnimate = animationGate.consumeEvent('analysis', 'widget-perf');
    if (!shouldAnimate || displayedValue.current.val === accuracy) {
      displayedValue.current.val = accuracy;
      if (numberRef.current) numberRef.current.textContent = `${Math.round(accuracy)}%`;
      return;
    }
    gsap.to(displayedValue.current, {
      val: accuracy,
      duration: 0.6,
      ease: 'power2.out',
      onUpdate: () => {
        if (numberRef.current) numberRef.current.textContent = `${Math.round(displayedValue.current.val)}%`;
      },
    });
  }, [accuracy, idle]);

  const accColor = idle ? '#71717a' : accuracy >= 90 ? '#22c55e' : accuracy >= 70 ? '#38bdf8' : accuracy >= 50 ? '#fbbf24' : '#f87171';
  const trendSymbol = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '—';
  const trendColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#f87171' : '#71717a';
  const dim = 'rgba(255,255,255,0.2)';

  return (
    <div style={{ ...fCard, ...fRow }}>
      <span ref={numberRef} style={{ fontSize: 15, fontWeight: 700, color: idle ? dim : accColor, fontVariantNumeric: 'tabular-nums' }}>
        {idle ? '—' : `${Math.round(accuracy)}%`}
      </span>
      {!idle && <span style={{ fontSize: 9, color: trendColor }}>{trendSymbol}</span>}
      <div style={{ width: 1, height: 14, background: idle ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {CLS_CONFIG.map(({ key, color }) => (
          <div key={key} style={{ textAlign: 'center', flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: idle ? dim : color, fontVariantNumeric: 'tabular-nums', display: 'block' }}>
              {idle ? '0' : counts[key as keyof typeof counts]}
            </span>
            <span style={{ fontSize: 5, color: idle ? dim : 'rgba(255,255,255,0.2)', display: 'block' }}>
              {key.charAt(0).toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function renderPinnedComponent(id: string): React.ReactNode | null {
  // When `elo` is pinned, it absorbs `search` as a submodule — don't render
  // a separate floating card for search.
  const pinned = useLayoutStore.getState().pinned;
  switch (id) {
    case 'gameinfo': return <FloatingGameInfo />;
    case 'performance': return <CompactPerformance />;
    case 'suggestions': return <FloatingSuggestions />;
    case 'elo': return <FloatingElo />;
    case 'search': return pinned.includes('elo') ? null : <FloatingSearch />;
    case 'force': return pinned.includes('elo') ? null : <FloatingForce />;
    case 'personality': return <FloatingPersonality />;
    case 'ambition': return <FloatingAmbition />;
    case 'variety': return <FloatingVariety />;
    default: return null;
  }
}
