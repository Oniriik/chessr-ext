import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useEngineStore, type Personality, PERSONALITY_INFO, getDynamismLabel, getKingSafetyLabel } from '../stores/engineStore';
import { useLayoutStore } from '../stores/layoutStore';
import { animationGate } from '../stores/animationStore';
import { COMPONENT_REGISTRY } from './ComponentRegistry';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import PerformanceCard from './PerformanceCard';
import SuggestionRow from './SuggestionRow';
import AutoMoveTab from './AutoMoveTab';
import { useAutoMoveStore, formatCountdown } from '../stores/autoMoveStore';
import EditableComponent from './EditableComponent';
import TabBar from './TabBar';
import Toggle from './Toggle';
import Slider, { lerpColor } from './Slider';
import GameSummaryCard from './GameSummaryCard';
import { useGameMeta } from '../hooks/useGameMeta';
import { useReviewStore } from '../stores/reviewStore';
import { ReviewSummary } from './ReviewScreen';
import './review-screen.css';
import './game-screen.css';

type GameTab = 'game' | 'engine' | 'automove';

const GAME_TABS: { id: GameTab; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'engine', label: 'Engine' },
  { id: 'automove', label: 'Auto Move' },
];

export type { GameTab };

function SortableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <EditableComponent id={id} dragHandleProps={{ ...attributes, ...listeners }} isDragging={isDragging}>
        {children}
      </EditableComponent>
    </div>
  );
}

export type GameOutcome = 'win' | 'draw' | 'loss';

export function getGameOutcome(
  gameEnd: import('../stores/gameStore').GameEndInfo | null,
  result: string,
  playerColor: string | null,
  turn: string | null,
): GameOutcome {
  const isDraw = result === '1/2-1/2' || gameEnd?.stalemate || gameEnd?.draw || gameEnd?.threefold || gameEnd?.insufficient || gameEnd?.fiftyMoveRule;
  if (isDraw) return 'draw';
  const isWin =
    (result === '1-0' && playerColor === 'white') ||
    (result === '0-1' && playerColor === 'black') ||
    (gameEnd?.checkmate && turn !== playerColor);
  return isWin ? 'win' : 'loss';
}

export function getGameStatus(
  gameEnd: import('../stores/gameStore').GameEndInfo | null,
  result: string,
  playerColor: string | null,
  turn: string | null,
): string {
  // Position-based endings (from getPositionInfo flags)
  if (gameEnd) {
    if (gameEnd.checkmate) {
      const loserColor = turn;
      return loserColor === playerColor ? 'Checkmate — You lost' : 'Checkmate — You won!';
    }
    if (gameEnd.stalemate) return 'Stalemate';
    if (gameEnd.threefold) return 'Draw — Threefold';
    if (gameEnd.insufficient) return 'Draw — Insufficient';
    if (gameEnd.fiftyMoveRule) return 'Draw — 50 moves';
    if (gameEnd.draw) return 'Draw';
  }
  // Server-side endings (resign, timeout, abandon) — use PGN result
  if (result === '1/2-1/2') return 'Draw';
  if (result === '1-0') return playerColor === 'white' ? 'You won!' : 'You lost';
  if (result === '0-1') return playerColor === 'black' ? 'You won!' : 'You lost';
  return 'Game over';
}

function GameOverCard({ gameId, playerColor }: { gameId: string; playerColor: string | null }) {
  const meta = useGameMeta(gameId);
  const { loading, progress, analysis, headers, error, checkCache, requestReview } = useReviewStore();

  useEffect(() => { checkCache(gameId); }, [gameId]);

  const idle = !loading && !analysis && !error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!analysis && (
        <GameSummaryCard
          whiteName={meta.whiteName} blackName={meta.blackName}
          whiteRating={meta.whiteRating} blackRating={meta.blackRating}
          result={meta.result} playerColor={playerColor as 'white' | 'black' | null}
          timeControl={meta.timeControl} moveCount={meta.moveCount}
          termination={meta.termination}
        />
      )}

      {idle && (
        <button className="game-review-btn" onClick={() => requestReview(gameId)}>
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
        <button className="game-review-btn game-review-btn--upgrade" onClick={() => window.open('https://chessr.io/#pricing', '_blank')}>
          Upgrade to Premium
          <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.7, display: 'block', marginTop: 2 }}>Daily limit reached</span>
        </button>
      )}

      {error && error !== 'daily_limit' && (
        <div className="review-error">{`Error: ${error}`}</div>
      )}

      {analysis && (
        <>
          <ReviewSummary
            analysis={analysis}
            playerColor={playerColor || 'white'}
            headers={headers}
          />
          <button className="game-review-btn" onClick={() => window.open(`https://app.chessr.io/review/${gameId}`, '_blank')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            See full review
          </button>
        </>
      )}
    </div>
  );
}

export default function GameScreen({ activeTab, setActiveTab }: { activeTab: GameTab; setActiveTab: (t: GameTab) => void }) {
  const { playerColor, turn, fen, gameOver, gameEnd, result } = useGameStore();
  const { suggestions, loading } = useSuggestionStore();
  const suggestionsListRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Skip animations on first mount — only animate when suggestions change while mounted
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      animationGate.consumeEvent('suggestions', 'panel'); // drain any pending event
      return;
    }
    if (suggestions.length > 0 && animationGate.consumeEvent('suggestions', 'panel') && suggestionsListRef.current) {
      suggestionsListRef.current.classList.add('game-suggestions-list--animate');
      const timer = setTimeout(() => {
        suggestionsListRef.current?.classList.remove('game-suggestions-list--animate');
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [suggestions]);
  const { arrowColors, numArrows } = useSettingsStore();
  const autoMoveMode = useAutoMoveStore((st) => st.mode);
  const autoPaused = useAutoMoveStore((st) => st.autoPaused);
  const autoCountdownMs = useAutoMoveStore((st) => st.autoCountdownMs);
  const setAutoPaused = useAutoMoveStore((st) => st.setAutoPaused);
  const hotkey1 = useAutoMoveStore((st) => st.hotkey1);
  const hotkey2 = useAutoMoveStore((st) => st.hotkey2);
  const hotkey3 = useAutoMoveStore((st) => st.hotkey3);
  const hotkeys = [hotkey1, hotkey2, hotkey3];
  const gameOrder = useLayoutStore((s) => s.gameOrder);
  const setOrder = useLayoutStore((s) => s.setOrder);
  const isMyTurn = playerColor && turn && playerColor === turn;

  // Tab-change fade-in
  const tabContentRef = useRef<HTMLDivElement>(null);
  const firstTabRender = useRef(true);
  useLayoutEffect(() => {
    if (firstTabRender.current) { firstTabRender.current = false; return; }
    if (!tabContentRef.current) return;
    if (useSettingsStore.getState().disableAnimations) return;
    gsap.fromTo(tabContentRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' });
  }, [activeTab]);

  // Extract gameId for Chess.com review link (not for bot games)
  const [gameId, setGameId] = useState<string | null>(null);
  useEffect(() => {
    function extractGameId(): string | null {
      const path = window.location.pathname;
      // Don't show review for bot games
      if (path.includes('/computer')) return null;
      const match = path.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/);
      return match ? match[1] : null;
    }
    const id = extractGameId();
    if (id) { setGameId(id); return; }
    // If gameOver but no gameId yet, poll briefly (Chess.com may redirect after a delay)
    if (!gameOver) return;
    let attempts = 0;
    const interval = setInterval(() => {
      const newId = extractGameId();
      if (newId || ++attempts >= 10) {
        if (newId) setGameId(newId);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [gameOver]);


  const engineOrder = useLayoutStore((s) => s.engineOrder);

  const handleGameDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = gameOrder.indexOf(active.id as string);
      const newIndex = gameOrder.indexOf(over.id as string);
      setOrder('game', arrayMove(gameOrder, oldIndex, newIndex));
    }
  };

  const handleEngineDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = engineOrder.indexOf(active.id as string);
      const newIndex = engineOrder.indexOf(over.id as string);
      setOrder('engine', arrayMove(engineOrder, oldIndex, newIndex));
    }
  };

  return (
    <div className="game-screen">
      <EditableComponent id="gameinfo">
        <div className="game-card">
          <div className="game-card-left">
            <div className={`game-piece ${playerColor === 'white' ? 'game-piece--white' : 'game-piece--black'} ${isMyTurn ? 'game-piece--active' : ''}`} />
            <div className="game-card-info">
              <span className="game-card-label">You play</span>
              <span className="game-card-color">{playerColor === 'white' ? 'White' : 'Black'}</span>
            </div>
            <button
              type="button"
              className="game-rescan-btn"
              onClick={() => window.dispatchEvent(new Event('chessr:rescan'))}
              title="Rescan state (re-detect turn, color, refresh suggestions)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
          <div className="game-card-right">
            {autoMoveMode === 'auto' && !gameOver ? (
              <div className="game-turn-pill game-turn-pill--auto">
                <span className="game-turn-dot" />
                <span>
                  {autoPaused
                    ? 'Paused'
                    : isMyTurn
                      ? (autoCountdownMs != null ? `Playing in ${formatCountdown(autoCountdownMs)}` : 'Playing…')
                      : "Opponent's turn"}
                </span>
              </div>
            ) : (
              <div className={`game-turn-pill ${gameOver ? `game-turn-pill--over game-turn-pill--${getGameOutcome(gameEnd, result, playerColor, turn)}` : isMyTurn ? 'game-turn-pill--you' : ''}`}>
                <span className="game-turn-dot" />
                <span>{gameOver ? getGameStatus(gameEnd, result, playerColor, turn) : isMyTurn ? 'Your turn' : "Opponent's turn"}</span>
              </div>
            )}
            {autoMoveMode === 'auto' && !gameOver && (
              <button
                type="button"
                className={`game-auto-btn ${autoPaused ? 'game-auto-btn--paused' : ''}`}
                onClick={() => setAutoPaused(!autoPaused)}
                title={autoPaused ? 'Resume auto-play' : 'Pause auto-play'}
              >
                {autoPaused ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
                )}
              </button>
            )}
          </div>
        </div>
      </EditableComponent>

      <TabBar tabs={GAME_TABS} active={activeTab} onChange={setActiveTab} />

      <div ref={tabContentRef} className="game-tab-content">
      {activeTab === 'game' && (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleGameDragEnd}>
          <SortableContext items={gameOrder} strategy={verticalListSortingStrategy}>
            {gameOrder.map((id) => {
              if (id === 'performance') {
                return (
                  <SortableItem key={id} id={id}>
                    <PerformanceCard />
                  </SortableItem>
                );
              }
              if (id === 'suggestions') {
                return (
                  <SortableItem key={id} id={id}>
                    {gameOver && gameId ? (
                      <GameOverCard gameId={gameId} playerColor={playerColor} />
                    ) : (
                      <div className="game-suggestions">
                        <div className="game-suggestions-header">
                          <div className="game-suggestions-label-group">
                            <span className="game-suggestions-label">Suggestions</span>
                            {suggestions.length > 0 && suggestions[0]?.depth != null && (
                              <span className="game-suggestions-depth" title="Search depth reached">depth {suggestions[0].depth}</span>
                            )}
                          </div>
                          <div className="game-suggestions-legend">
                            <span>Pos</span>
                            <span>Win</span>
                          </div>
                        </div>
                        {suggestions.length > 0 ? (
                          <div ref={suggestionsListRef} className="game-suggestions-list">
                            {suggestions.map((s, i) => (
                              <SuggestionRow key={s.move} suggestion={s} index={i} color={arrowColors[i]} fen={fen || ''} hotkey={autoMoveMode === 'hotkey' ? hotkeys[i] : undefined} />
                            ))}
                          </div>
                        ) : (
                          <div className="game-suggestions-list">
                            {Array.from({ length: numArrows }).map((_, i) => (
                              <div key={i} className="game-suggestion-skeleton" style={{ borderLeftColor: arrowColors[i], background: `${arrowColors[i]}08` }}>
                                <div className="game-skeleton-bar" style={{ width: 40, background: `${arrowColors[i]}15` }} />
                                <div className="game-skeleton-bar" style={{ width: 24, marginLeft: 'auto' }} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </SortableItem>
                );
              }
              return null;
            })}
          </SortableContext>
        </DndContext>
      )}

      {activeTab === 'engine' && (
        <EnginePanel onDragEnd={handleEngineDragEnd} />
      )}

      {activeTab === 'automove' && (
        <AutoMoveTab />
      )}
      </div>
    </div>
  );
}

function isPremium(plan: string): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';
}

function EloSection() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const effectiveElo = engine.getEffectiveElo();
  const editMode = useLayoutStore((s) => s.editMode);
  const searchPinned = useLayoutStore((s) => s.pinned.includes('search'));
  const forcePinned = useLayoutStore((s) => s.pinned.includes('force'));
  const togglePin = useLayoutStore((s) => s.togglePin);
  if (!engine.capabilities.hasUciElo) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">Target ELO</span>
        <button className={`engine-auto-btn ${engine.targetEloAuto ? 'engine-auto-btn--active' : ''}`} onClick={() => engine.setTargetEloAuto(!engine.targetEloAuto)}>Auto</button>
      </div>
      <div className="engine-elo-display"><span className="engine-elo-value">{effectiveElo}</span></div>
      {engine.targetEloAuto && (
        <span className="engine-desc">{engine.opponentElo > 0 ? `Opponent ${engine.opponentElo} + ${engine.autoEloBoost} boost` : `No opponent detected, using ${engine.userElo} + ${engine.autoEloBoost} boost`}</span>
      )}
      {!engine.targetEloAuto && (
        <Slider
          min={400}
          max={premium ? (engine.limitStrength ? 2500 : 3500) : 2000}
          step={50}
          value={engine.targetEloManual}
          onChange={(v) => {
            engine.setTargetEloManual(v);
            if (v < 2500 && !engine.limitStrength) engine.setLimitStrength(true);
          }}
          trackColor={!engine.limitStrength ? 'linear-gradient(90deg, #22c55e, #3b82f6, #ef4444)' : 'linear-gradient(90deg, #22c55e, #3b82f6)'}
          thumbColor="#22c55e"
          thumbColorEnd={!engine.limitStrength ? '#ef4444' : '#3b82f6'}
        />
      )}
      {!premium && (
        <span className="engine-desc" style={{ color: '#fbbf24' }}>Upgrade to premium to unlock ELO up to 3500 and full engine tuning</span>
      )}

      <div className="engine-subsection">
        <div className="engine-section-header">
          <div className="engine-section-label-group">
            <span className="engine-section-label" style={{ fontSize: 9 }}>Max search depth</span>
            {editMode && (
              <button
                type="button"
                className={`engine-sub-pin ${searchPinned ? 'engine-sub-pin--active' : ''}`}
                title={searchPinned ? 'Unpin from page' : 'Pin to page'}
                onClick={() => togglePin('search')}
              >
                📌
              </button>
            )}
          </div>
          <select
            value={engine.searchMode}
            disabled={!premium}
            onChange={(e) => engine.setSearchMode(e.target.value as 'nodes' | 'depth' | 'movetime')}
            className="engine-select"
          >
            <option value="nodes">Nodes</option>
            <option value="depth">Depth</option>
            <option value="movetime">Move Time</option>
          </select>
        </div>
        <div className="engine-section-header">
          {engine.searchMode === 'nodes' && (
            <>
              <Slider min={100000} max={5000000} step={100000} value={engine.searchNodes} onChange={engine.setSearchNodes} disabled={!premium}
                trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 30%, #a855f7 60%, #ef4444 100%)"
                thumbColorFn={(pct) => pct < 30 ? '#3b82f6' : pct < 60 ? lerpColor('#3b82f6', '#a855f7', (pct - 30) / 30) : lerpColor('#a855f7', '#ef4444', (pct - 60) / 40)} />
              <span className="engine-hint">{(engine.searchNodes / 1000000) >= 1 ? `${(engine.searchNodes / 1000000).toFixed(1)}M` : `${(engine.searchNodes / 1000).toFixed(0)}k`}</span>
            </>
          )}
          {engine.searchMode === 'depth' && (
            <>
              <Slider min={1} max={30} step={1} value={engine.searchDepth} onChange={engine.setSearchDepth} disabled={!premium}
                trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 40%, #a855f7 65%, #ef4444 100%)"
                thumbColorFn={(pct) => pct < 40 ? '#3b82f6' : pct < 65 ? lerpColor('#3b82f6', '#a855f7', (pct - 40) / 25) : lerpColor('#a855f7', '#ef4444', (pct - 65) / 35)} />
              <span className="engine-hint">{engine.searchDepth}</span>
            </>
          )}
          {engine.searchMode === 'movetime' && (
            <>
              <Slider min={500} max={5000} step={100} value={engine.searchMovetime} onChange={engine.setSearchMovetime} disabled={!premium}
                trackColor="linear-gradient(90deg, #3b82f6 0%, #3b82f6 25%, #a855f7 55%, #ef4444 100%)"
                thumbColorFn={(pct) => pct < 25 ? '#3b82f6' : pct < 55 ? lerpColor('#3b82f6', '#a855f7', (pct - 25) / 30) : lerpColor('#a855f7', '#ef4444', (pct - 55) / 45)} />
              <span className="engine-hint">{(engine.searchMovetime / 1000).toFixed(1)}s</span>
            </>
          )}
        </div>
      </div>

      <div className="engine-force-row">
        <div className="engine-force-text">
          <div className="engine-section-label-group">
            <span className="engine-force-label">Force search depth</span>
            {editMode && (
              <button
                type="button"
                className={`engine-sub-pin ${forcePinned ? 'engine-sub-pin--active' : ''}`}
                title={forcePinned ? 'Unpin from page' : 'Pin to page'}
                onClick={() => togglePin('force')}
              >
                📌
              </button>
            )}
          </div>
          <span className="engine-force-desc">
            {premium
              ? 'Bypass engine self-limiting; unlocks up to 3500 ELO.'
              : 'Premium — bypass engine self-limiting and tune search budget.'}
          </span>
        </div>
        <Toggle
          checked={!engine.limitStrength && premium}
          onChange={(v) => { if (premium) engine.setLimitStrength(!v); }}
          disabled={!premium}
        />
      </div>
    </div>
  );
}

function PersonalitySection() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const personalities = engine.getPersonalities(plan);
  const premium = isPremium(plan);
  const allPersonalities = Object.keys(PERSONALITY_INFO) as Personality[];
  if (!engine.capabilities.hasPersonality) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <div className="engine-section-label-group">
          <span className="engine-section-label">Personality</span>
          <span className="engine-info-icon" aria-label="All personalities">
            i
            <div className="engine-info-tooltip" role="tooltip">
              {allPersonalities.map((p) => (
                <div key={p} className="engine-info-tooltip-item">
                  <span className="engine-info-tooltip-name">{PERSONALITY_INFO[p].label}</span>
                  <span className="engine-info-tooltip-desc">{PERSONALITY_INFO[p].desc}</span>
                </div>
              ))}
            </div>
          </span>
        </div>
        <select value={engine.personality} onChange={(e) => engine.setPersonality(e.target.value as Personality)} className="engine-select">
          {personalities.map((p) => (<option key={p} value={p}>{PERSONALITY_INFO[p].label}</option>))}
        </select>
      </div>
      <span className="engine-desc">{PERSONALITY_INFO[engine.personality].desc}</span>
      {!premium && (
        <span className="engine-desc" style={{ color: '#fbbf24' }}>Upgrade to premium to unlock more personalities</span>
      )}
    </div>
  );
}

function DynamismSection() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const info = getDynamismLabel(engine.dynamism);
  const sliderDisabled = !premium || engine.dynamismAuto;
  if (!engine.capabilities.hasDynamism) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">Dynamism</span>
        <button className={`engine-auto-btn ${engine.dynamismAuto ? 'engine-auto-btn--active' : ''} ${!premium ? 'engine-auto-btn--locked' : ''}`} onClick={() => premium && engine.setDynamismAuto(!engine.dynamismAuto)}>Auto</button>
      </div>
      <Slider
        min={0} max={200} step={5}
        value={engine.dynamismAuto ? 100 : engine.dynamism}
        onChange={engine.setDynamism}
        disabled={sliderDisabled}
        trackColor="linear-gradient(90deg, #3b82f6, #a855f7, #ef4444)"
        thumbColorFn={(pct) => lerpColor('#3b82f6', '#ef4444', pct / 100)}
      />
      <div className="engine-desc-row">
        <span className="engine-desc-label">{info.label} ({engine.dynamismAuto ? 100 : engine.dynamism})</span>
        <span className="engine-desc">{!premium ? 'Unlock with premium' : engine.dynamismAuto ? 'Engine uses its default dynamism' : info.desc}</span>
      </div>
    </div>
  );
}

function KingSafetySection() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const info = getKingSafetyLabel(engine.kingSafety);
  const sliderDisabled = !premium || engine.kingSafetyAuto;
  if (!engine.capabilities.hasKingSafety) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">King Safety</span>
        <button className={`engine-auto-btn ${engine.kingSafetyAuto ? 'engine-auto-btn--active' : ''} ${!premium ? 'engine-auto-btn--locked' : ''}`} onClick={() => premium && engine.setKingSafetyAuto(!engine.kingSafetyAuto)}>Auto</button>
      </div>
      <Slider
        min={0} max={200} step={5}
        value={engine.kingSafetyAuto ? 100 : engine.kingSafety}
        onChange={engine.setKingSafety}
        disabled={sliderDisabled}
        trackColor="linear-gradient(90deg, #ef4444, #a855f7, #22c55e)"
        thumbColorFn={(pct) => lerpColor('#ef4444', '#22c55e', pct / 100)}
      />
      <div className="engine-desc-row">
        <span className="engine-desc-label">{info.label} ({engine.kingSafetyAuto ? 100 : engine.kingSafety})</span>
        <span className="engine-desc">{!premium ? 'Unlock with premium' : engine.kingSafetyAuto ? 'Engine uses its default king safety' : info.desc}</span>
      </div>
    </div>
  );
}

function VarietySection() {
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  if (!engine.capabilities.hasVariety) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">Variety</span>
        <span className="engine-hint">{engine.variety}</span>
      </div>
      <Slider min={0} max={10} step={1} value={engine.variety} onChange={engine.setVariety} disabled={!premium} trackColor="linear-gradient(90deg, #3b82f6, #f59e0b)" thumbColor="#3b82f6" thumbColorEnd="#f59e0b" />
      <span className="engine-desc">{engine.variety === 0 ? 'Engine always plays the strongest move' : premium ? 'Higher values make moves less predictable' : 'Unlock with premium'}</span>
    </div>
  );
}

const ENGINE_SECTIONS: Record<string, () => React.ReactNode> = {
  elo: () => <EloSection />,
  personality: () => <PersonalitySection />,
  dynamism: () => <DynamismSection />,
  kingsafety: () => <KingSafetySection />,
  variety: () => <VarietySection />,
};

function EnginePanel({ onDragEnd }: { onDragEnd: (event: DragEndEvent) => void }) {
  const engineOrder = useLayoutStore((s) => s.engineOrder);

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={engineOrder} strategy={verticalListSortingStrategy}>
        <div className="engine-panel">
          {engineOrder.map((id) => {
            const renderFn = ENGINE_SECTIONS[id];
            if (!renderFn) return null;
            return (
              <SortableItem key={id} id={id}>
                {renderFn()}
              </SortableItem>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
