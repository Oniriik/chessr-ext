import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useEngineStore, type Personality, PERSONALITY_INFO, getDynamismLabel, getKingSafetyLabel, MAIA_VARIANT_INFO, type MaiaVariant, ENGINE_INFO, RODENT_PERSONALITY_GROUPS } from '../stores/engineStore';
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
import { isPremium } from '../lib/premium';
import Slider, { lerpColor } from './Slider';
import GameSummaryCard from './GameSummaryCard';
import { useGameMeta } from '../hooks/useGameMeta';
import { useReviewStore } from '../stores/reviewStore';
import { ReviewSummary } from './ReviewScreen';
import { useTranslation, t as tStatic } from '../lib/i18n';
import './review-screen.css';
import './game-screen.css';

type GameTab = 'game' | 'engine' | 'automove';

function useGameTabs(): { id: GameTab; label: string }[] {
  const { t } = useTranslation();
  return [
    { id: 'game',     label: t('game.tab.game') },
    { id: 'engine',   label: t('game.tab.engine') },
    { id: 'automove', label: t('game.tab.automove') },
  ];
}

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
      return loserColor === playerColor ? tStatic('game.status.checkmateLost') : tStatic('game.status.checkmateWon');
    }
    if (gameEnd.stalemate) return tStatic('game.status.stalemate');
    if (gameEnd.threefold) return tStatic('game.status.drawThreefold');
    if (gameEnd.insufficient) return tStatic('game.status.drawInsufficient');
    if (gameEnd.fiftyMoveRule) return tStatic('game.status.drawFifty');
    if (gameEnd.draw) return tStatic('game.status.draw');
  }
  // Server-side endings (resign, timeout, abandon) — use PGN result
  if (result === '1/2-1/2') return tStatic('game.status.draw');
  if (result === '1-0') return playerColor === 'white' ? tStatic('game.status.youWon') : tStatic('game.status.youLost');
  if (result === '0-1') return playerColor === 'black' ? tStatic('game.status.youWon') : tStatic('game.status.youLost');
  return tStatic('game.status.gameOver');
}

function GameOverCard({ gameId, playerColor }: { gameId: string; playerColor: string | null }) {
  const { t } = useTranslation();
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
          {t('game.review.analyze')}
        </button>
      )}

      {loading && (
        <div className="review-loading">
          <div className="review-progress-track"><div className="review-progress-fill" style={{ width: `${progress}%` }} /></div>
          <span className="review-progress-text">{t('game.review.analyzing', { progress })}</span>
        </div>
      )}

      {error === 'daily_limit' && (
        <button className="game-review-btn game-review-btn--upgrade" onClick={() => window.open('https://chessr.io/#pricing', '_blank')}>
          {t('game.review.upgrade')}
          <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.7, display: 'block', marginTop: 2 }}>{t('game.review.dailyLimit')}</span>
        </button>
      )}

      {error && error !== 'daily_limit' && (
        <div className="review-error">{t('game.review.errorPrefix', { msg: error })}</div>
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
            {t('game.review.seeFull')}
          </button>
        </>
      )}
    </div>
  );
}

export default function GameScreen({ activeTab, setActiveTab }: { activeTab: GameTab; setActiveTab: (t: GameTab) => void }) {
  const { t } = useTranslation();
  const GAME_TABS = useGameTabs();
  const { isPlaying, playerColor, turn, fen, gameOver, gameEnd, result } = useGameStore();
  const { suggestions, loading } = useSuggestionStore();
  const activeEngineId = useEngineStore((s) => s.engineId);
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
        <div className={`game-card ${!isPlaying ? 'game-card--idle' : ''}`}>
          <div className="game-card-left">
            <div className={`game-piece ${!isPlaying ? 'game-piece--idle' : playerColor === 'white' ? 'game-piece--white' : 'game-piece--black'} ${isMyTurn ? 'game-piece--active' : ''}`} />
            <div className="game-card-info">
              {!isPlaying ? (
                <span className="game-card-waiting">{t('game.card.waiting')}</span>
              ) : (
                <>
                  <span className="game-card-label">{t('game.card.youPlay')}</span>
                  <span className="game-card-color">{playerColor === 'white' ? t('game.card.white') : t('game.card.black')}</span>
                </>
              )}
            </div>
            <button
              type="button"
              className="game-rescan-btn"
              onClick={() => window.dispatchEvent(new Event('chessr:rescan'))}
              title={isPlaying ? t('game.card.rescan') : t('game.card.tryDetect')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
          <div className="game-card-right">
            {!isPlaying ? null : autoMoveMode === 'auto' && !gameOver ? (
              <div className="game-turn-pill game-turn-pill--auto">
                <span className="game-turn-dot" />
                <span>
                  {autoPaused
                    ? t('game.auto.paused')
                    : isMyTurn
                      ? (autoCountdownMs != null ? t('game.auto.playingIn', { time: formatCountdown(autoCountdownMs) }) : t('game.auto.playing'))
                      : t('game.turn.opponent')}
                </span>
              </div>
            ) : (
              <div className={`game-turn-pill ${gameOver ? `game-turn-pill--over game-turn-pill--${getGameOutcome(gameEnd, result, playerColor, turn)}` : isMyTurn ? 'game-turn-pill--you' : ''}`}>
                <span className="game-turn-dot" />
                <span>{gameOver ? getGameStatus(gameEnd, result, playerColor, turn) : isMyTurn ? t('game.turn.your') : t('game.turn.opponent')}</span>
              </div>
            )}
            {isPlaying && autoMoveMode === 'auto' && !gameOver && (
              <button
                type="button"
                className={`game-auto-btn ${autoPaused ? 'game-auto-btn--paused' : ''}`}
                onClick={() => setAutoPaused(!autoPaused)}
                title={autoPaused ? t('game.auto.resume') : t('game.auto.pause')}
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
                            <span className="game-suggestions-label">{t('game.suggestions.title')}</span>
                            <span className="game-suggestions-engine" title={t('game.suggestions.engineHint')}>{ENGINE_INFO[activeEngineId]?.label ?? activeEngineId}</span>
                            {isPlaying && suggestions.length > 0 && suggestions[0]?.depth != null && suggestions[0].depth > 0 && (
                              <span className="game-suggestions-depth" title={t('game.suggestions.depthReached')}>{t('game.suggestions.depth', { n: suggestions[0].depth })}</span>
                            )}
                          </div>
                          {isPlaying && (
                            <div className="game-suggestions-legend">
                              <span>{t('game.suggestions.legendPos')}</span>
                              <span>{t('game.suggestions.legendWin')}</span>
                            </div>
                          )}
                        </div>
                        {!isPlaying ? (
                          <div className="game-waiting">
                            <div className="game-waiting-pulse" />
                            <p className="game-waiting-text">{t('game.waiting.title')}</p>
                            <p className="game-waiting-hint">
                              {t('game.waiting.hint')}
                            </p>
                          </div>
                        ) : suggestions.length > 0 ? (
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

function EloSection() {
  const { t } = useTranslation();
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const effectiveElo = engine.getEffectiveElo();
  const editMode = useLayoutStore((s) => s.editMode);
  const searchPinned = useLayoutStore((s) => s.pinned.includes('search'));
  const forcePinned = useLayoutStore((s) => s.pinned.includes('force'));
  const togglePin = useLayoutStore((s) => s.togglePin);
  if (!engine.capabilities.hasUciElo) return null;
  // Per-engine ELO slider bounds. Match the engine's native UCI_Elo range so
  // users can't pick an ELO the engine will silently clamp (avoids "I asked
  // for 800 but it plays like 1320" surprises).
  //   Stockfish    : 1320–3500 (its UCI_Elo floor is 1320)
  //   Rodent IV    :  800–2800 (UCI_Elo range from Rodent's option output)
  //   Komodo / def :  400–3500 (Komodo accepts down to 400)
  const sliderMin = engine.engineId === 'stockfish' ? 1320
                  : engine.engineId === 'rodent'    ? 800
                  : 400;
  const sliderMax = engine.engineId === 'rodent'
    ? 2800
    : (premium ? (engine.limitStrength ? 2500 : 3500) : 2000);
  // Rodent's UCI_Elo is entirely ignored when LimitStrength=false (the engine
  // self-manages search via internal skill caps), so we hide the Elo block in
  // Force-Depth mode to avoid showing a useless slider. Komodo/Stockfish keep
  // their Elo visible in all modes — even with LimitStrength=false the slider
  // value persists and the user is just one toggle away from re-using it.
  const hideEloOnForceDepth = engine.engineId === 'rodent' && !engine.limitStrength;
  return (
    <div className="engine-section">
      {!hideEloOnForceDepth && (
        <>
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.targetElo')}</span>
            <button className={`engine-auto-btn ${engine.targetEloAuto ? 'engine-auto-btn--active' : ''}`} onClick={() => engine.setTargetEloAuto(!engine.targetEloAuto)}>{t('common.auto')}</button>
          </div>
          <div className="engine-elo-display"><span className="engine-elo-value">{effectiveElo}</span></div>
          {engine.targetEloAuto && (
            <span className="engine-desc">{engine.opponentElo > 0 ? t('engine.opponentBoost', { elo: engine.opponentElo, boost: engine.autoEloBoost }) : t('engine.noOpponent', { elo: engine.userElo, boost: engine.autoEloBoost })}</span>
          )}
          {!engine.targetEloAuto && (
            <Slider
              min={sliderMin}
              max={sliderMax}
              step={50}
              value={Math.max(sliderMin, Math.min(sliderMax, engine.targetEloManual))}
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
            <span className="engine-desc" style={{ color: '#fbbf24' }}>{t('engine.upgradeUnlock')}</span>
          )}
        </>
      )}

      {/* Search submodule only renders when Force Depth is ON
       *  (limitStrength=false): otherwise the UCI_LimitStrength path drives
       *  the search budget internally and exposing depth/nodes/movetime is
       *  meaningless. When the Elo controls are also hidden (limitStrength
       *  is false), strip the .engine-subsection's top divider / margin /
       *  padding — they exist to separate the search submodule from Elo
       *  controls above it, but here there's nothing above. */}
      {!engine.limitStrength && (
        <div
          className="engine-subsection"
          style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}
        >
          <div className="engine-section-header">
            <div className="engine-section-label-group">
              <span className="engine-section-label" style={{ fontSize: 9 }}>{t('engine.search.title')}</span>
              {editMode && (
                <button
                  type="button"
                  className={`engine-sub-pin ${searchPinned ? 'engine-sub-pin--active' : ''}`}
                  title={searchPinned ? t('engine.unpinPage') : t('engine.pinPage')}
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
              <option value="nodes">{t('engine.search.nodes')}</option>
              <option value="depth">{t('engine.search.depth')}</option>
              <option value="movetime">{t('engine.search.movetime')}</option>
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
      )}

      <div className="engine-force-row">
        <div className="engine-force-text">
          <div className="engine-section-label-group">
            <span className="engine-force-label">{t('engine.force.title')}</span>
            {editMode && (
              <button
                type="button"
                className={`engine-sub-pin ${forcePinned ? 'engine-sub-pin--active' : ''}`}
                title={forcePinned ? t('engine.unpinPage') : t('engine.pinPage')}
                onClick={() => togglePin('force')}
              >
                📌
              </button>
            )}
          </div>
          <span className="engine-force-desc">
            {premium ? t('engine.force.descPremium') : t('engine.force.descFree')}
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
  const { t } = useTranslation();
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
          <span className="engine-section-label">{t('engine.personality')}</span>
          <span className="engine-info-icon" aria-label={t('engine.personality.allTitle')}>
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
        <span className="engine-desc" style={{ color: '#fbbf24' }}>{t('engine.personality.upgrade')}</span>
      )}
    </div>
  );
}

function DynamismSection() {
  const { t } = useTranslation();
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  // Dynamism uses the REAL premium check (bypasses the beta override)
  // — premium-only knob even during beta. Same for KingSafety below.
  const premium = isPremium(plan);
  const info = getDynamismLabel(engine.dynamism);
  const sliderDisabled = !premium || engine.dynamismAuto;
  if (!engine.capabilities.hasDynamism) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">{t('engine.dynamism')}</span>
        <button className={`engine-auto-btn ${engine.dynamismAuto ? 'engine-auto-btn--active' : ''} ${!premium ? 'engine-auto-btn--locked' : ''}`} onClick={() => premium && engine.setDynamismAuto(!engine.dynamismAuto)}>{t('common.auto')}</button>
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
        <span className="engine-desc">{!premium ? t('engine.unlockPremium') : engine.dynamismAuto ? t('engine.dynamism.default') : info.desc}</span>
      </div>
    </div>
  );
}

function KingSafetySection() {
  const { t } = useTranslation();
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  // Real premium check — see DynamismSection above.
  const premium = isPremium(plan);
  const info = getKingSafetyLabel(engine.kingSafety);
  const sliderDisabled = !premium || engine.kingSafetyAuto;
  if (!engine.capabilities.hasKingSafety) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">{t('engine.kingSafety')}</span>
        <button className={`engine-auto-btn ${engine.kingSafetyAuto ? 'engine-auto-btn--active' : ''} ${!premium ? 'engine-auto-btn--locked' : ''}`} onClick={() => premium && engine.setKingSafetyAuto(!engine.kingSafetyAuto)}>{t('common.auto')}</button>
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
        <span className="engine-desc">{!premium ? t('engine.unlockPremium') : engine.kingSafetyAuto ? t('engine.kingSafety.default') : info.desc}</span>
      </div>
    </div>
  );
}

function VarietySection() {
  const { t } = useTranslation();
  const engine = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  if (!engine.capabilities.hasVariety) return null;
  return (
    <div className="engine-section">
      <div className="engine-section-header">
        <span className="engine-section-label">{t('engine.variety')}</span>
        <span className="engine-hint">{engine.variety}</span>
      </div>
      <Slider min={0} max={10} step={1} value={engine.variety} onChange={engine.setVariety} disabled={!premium} trackColor="linear-gradient(90deg, #3b82f6, #f59e0b)" thumbColor="#3b82f6" thumbColorEnd="#f59e0b" />
      <span className="engine-desc">{engine.variety === 0 ? t('engine.variety.strongest') : premium ? t('engine.variety.higher') : t('engine.unlockPremium')}</span>
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

/** Which sections each engine actually supports. Drives the edit-mode
 *  pin-slot rendering — Stockfish has no Personality / Variety / Dynamism
 *  / KingSafety so we don't reserve empty droppable rows for those.
 *  Komodo gets the full set. New engines added here as they're plugged in. */
const ENGINE_SUPPORTED_SECTIONS: Record<string, string[]> = {
  komodo:    ['elo', 'personality', 'dynamism', 'kingsafety', 'variety'],
  stockfish: ['elo'],
};

function EnginePanel({ onDragEnd }: { onDragEnd: (event: DragEndEvent) => void }) {
  const engineId = useEngineStore((s) => s.engineId);
  const engineOrder = useLayoutStore((s) => s.engineOrder);

  if (engineId === 'maia2') return <Maia2Panel />;
  if (engineId === 'maia3') return <Maia3Panel />;
  if (engineId === 'rodent') return <RodentPanel />;

  // Filter the user's section order to only those this engine supports —
  // otherwise edit mode shows empty drop slots for sections that render
  // null (e.g. Personality on Stockfish). Preserve the user's chosen
  // order via intersection rather than a separate per-engine ordering.
  const supported = ENGINE_SUPPORTED_SECTIONS[engineId] ?? ENGINE_SUPPORTED_SECTIONS.komodo;
  const supportedSet = new Set(supported);
  const visibleOrder = engineOrder.filter((id) => supportedSet.has(id));

  // Stockfish + Komodo share this layout — sections render based on the
  // engine's advertised capabilities (Personality / Variety / Dynamism /
  // KingSafety hide themselves on Stockfish, leaving the ELO + search-mode
  // sections visible). The chip at the top makes the active engine
  // explicit when the user is browsing between Komodo and Stockfish.
  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
        <div className="engine-panel">
          <span className="engine-name-chip">{ENGINE_INFO[engineId]?.label ?? engineId}</span>
          {visibleOrder.map((id) => {
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

function Maia2Panel() {
  const { t } = useTranslation();
  const engine = useEngineStore();
  const variants = Object.keys(MAIA_VARIANT_INFO) as MaiaVariant[];

  const effectiveOppo = engine.getMaiaEffectiveOppoElo();
  const effectiveTarget = engine.getMaiaEffectiveTargetElo();
  const oppoDetected = engine.opponentElo > 0;

  return (
    <div className="engine-panel">
      <span className="engine-name-chip">{ENGINE_INFO.maia2.label}</span>

      <EditableComponent id="maia-variant">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.maia.variant')}</span>
            <select
              className="engine-select"
              value={engine.maiaVariant}
              onChange={(e) => engine.setMaiaVariant(e.target.value as MaiaVariant)}
            >
              {variants.map((v) => (
                <option key={v} value={v}>{MAIA_VARIANT_INFO[v].label}</option>
              ))}
            </select>
          </div>
          <span className="engine-desc">{MAIA_VARIANT_INFO[engine.maiaVariant].desc}</span>
        </div>
      </EditableComponent>

      <EditableComponent id="maia-target-elo">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.targetElo')}</span>
            <button
              className={`engine-auto-btn ${engine.maiaTargetEloAuto ? 'engine-auto-btn--active' : ''}`}
              onClick={() => engine.setMaiaTargetEloAuto(!engine.maiaTargetEloAuto)}
            >{t('common.auto')}</button>
          </div>
          <div className="engine-elo-display"><span className="engine-elo-value">{effectiveTarget}</span></div>
          {engine.maiaTargetEloAuto ? (
            <span className="engine-desc">
              {t('engine.opponentBoost', { elo: effectiveOppo, boost: engine.autoEloBoost })}
            </span>
          ) : (
            <Slider
              min={1100} max={2000} step={100}
              value={engine.maiaTargetEloManual}
              onChange={engine.setMaiaTargetEloManual}
              trackColor="linear-gradient(90deg, #22c55e, #3b82f6)"
              thumbColor="#22c55e"
              thumbColorEnd="#3b82f6"
            />
          )}
        </div>
      </EditableComponent>

      <EditableComponent id="maia-oppo-elo">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.maia.opponentElo')}</span>
            <button
              className={`engine-auto-btn ${engine.maiaOppoEloAuto ? 'engine-auto-btn--active' : ''}`}
              onClick={() => engine.setMaiaOppoEloAuto(!engine.maiaOppoEloAuto)}
            >{t('common.auto')}</button>
          </div>
          <div className="engine-elo-display"><span className="engine-elo-value">{effectiveOppo}</span></div>
          {engine.maiaOppoEloAuto ? (
            <span className="engine-desc">
              {oppoDetected ? t('engine.maia.detected', { elo: engine.opponentElo }) : t('engine.maia.fallback', { elo: engine.maiaOppoEloManual })}
            </span>
          ) : (
            <Slider
              min={1100} max={2000} step={100}
              value={engine.maiaOppoEloManual}
              onChange={engine.setMaiaOppoEloManual}
              trackColor="linear-gradient(90deg, #3b82f6, #ef4444)"
              thumbColor="#3b82f6"
              thumbColorEnd="#ef4444"
            />
          )}
        </div>
      </EditableComponent>

      <div className="engine-warning">
        <div className="engine-warning-head">
          <span className="engine-warning-icon" aria-hidden>!</span>
          <div className="engine-warning-body">
            <span className="engine-warning-title">{t('engine.maia.warningTitle')}</span>
            <span className="engine-warning-text">
              {t('engine.maia.warningBody')}
            </span>
          </div>
        </div>

        <div className="engine-warning-fix">
          <span className="engine-warning-fix-arrow" aria-hidden>↳</span>
          <div className="engine-warning-fix-text">
            <span className="engine-warning-fix-title">
              {t('engine.maia.fixBook')} <span className="engine-warning-fix-pill">{t('engine.maia.fixBookPill')}</span>
            </span>
            <span className="engine-warning-fix-desc">
              {t('engine.maia.fixBookDesc')}
            </span>
          </div>
          <Toggle
            checked={engine.maiaUseBook}
            onChange={engine.setMaiaUseBook}
          />
        </div>
      </div>

      <span className="engine-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {t('engine.maia.strengthNote')}
      </span>
    </div>
  );
}

function Maia3Panel() {
  const { t } = useTranslation();
  const engine = useEngineStore();

  const effectiveOppo = engine.getMaiaEffectiveOppoElo();
  const effectiveTarget = engine.getMaiaEffectiveTargetElo();
  const oppoDetected = engine.opponentElo > 0;

  return (
    <div className="engine-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="engine-name-chip">{ENGINE_INFO.maia3.label}</span>
        <span className="settings-engine-beta-badge">{t('engine.betaBadge')}</span>
      </div>

      <EditableComponent id="maia3-target-elo">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.targetElo')}</span>
            <button
              className={`engine-auto-btn ${engine.maiaTargetEloAuto ? 'engine-auto-btn--active' : ''}`}
              onClick={() => engine.setMaiaTargetEloAuto(!engine.maiaTargetEloAuto)}
            >{t('common.auto')}</button>
          </div>
          <div className="engine-elo-display"><span className="engine-elo-value">{effectiveTarget}</span></div>
          {engine.maiaTargetEloAuto ? (
            <span className="engine-desc">
              {t('engine.opponentBoost', { elo: effectiveOppo, boost: engine.autoEloBoost })}
            </span>
          ) : (
            <Slider
              min={600} max={2600} step={50}
              value={engine.maiaTargetEloManual}
              onChange={engine.setMaiaTargetEloManual}
              trackColor="linear-gradient(90deg, #22c55e, #3b82f6)"
              thumbColor="#22c55e"
              thumbColorEnd="#3b82f6"
            />
          )}
        </div>
      </EditableComponent>

      <EditableComponent id="maia3-oppo-elo">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.maia.opponentElo')}</span>
            <button
              className={`engine-auto-btn ${engine.maiaOppoEloAuto ? 'engine-auto-btn--active' : ''}`}
              onClick={() => engine.setMaiaOppoEloAuto(!engine.maiaOppoEloAuto)}
            >{t('common.auto')}</button>
          </div>
          <div className="engine-elo-display"><span className="engine-elo-value">{effectiveOppo}</span></div>
          {engine.maiaOppoEloAuto ? (
            <span className="engine-desc">
              {oppoDetected ? t('engine.maia.detected', { elo: engine.opponentElo }) : t('engine.maia.fallback', { elo: engine.maiaOppoEloManual })}
            </span>
          ) : (
            <Slider
              min={600} max={2600} step={50}
              value={engine.maiaOppoEloManual}
              onChange={engine.setMaiaOppoEloManual}
              trackColor="linear-gradient(90deg, #3b82f6, #ef4444)"
              thumbColor="#3b82f6"
              thumbColorEnd="#ef4444"
            />
          )}
        </div>
      </EditableComponent>

      <span className="engine-desc" style={{ marginTop: 8, lineHeight: 1.5 }}>
        {t('engine.maia.strengthNote')}
      </span>
    </div>
  );
}

function RodentPanel() {
  const { t } = useTranslation();
  const engine = useEngineStore();

  return (
    <div className="engine-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="engine-name-chip">{ENGINE_INFO.rodent.label}</span>
      </div>

      {/* Target ELO — full Komodo/Stockfish-style section with Auto + boost
       *  display + inline search subsection (depth/nodes/movetime) + Force
       *  Depth toggle that flips limitStrength off. EloSection adapts its
       *  slider bounds to the engineId (800-2800 for Rodent). */}
      <EditableComponent id="rodent-elo">
        <EloSection />
      </EditableComponent>

      {/* Imprecision — slider 0..100 → EvalBlur */}
      <EditableComponent id="rodent-imprecision">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.rodent.imprecision')}</span>
            <span className="engine-elo-value">{engine.imprecision}</span>
          </div>
          <Slider
            min={0} max={100} step={1}
            value={engine.imprecision}
            onChange={engine.setImprecision}
            trackColor="linear-gradient(90deg, #6b7280, #ef4444)"
            thumbColor="#6b7280"
            thumbColorEnd="#ef4444"
          />
          <span className="engine-desc">{t('engine.rodent.imprecisionDesc')}</span>
        </div>
      </EditableComponent>

      {/* Personality — grouped dropdown */}
      <EditableComponent id="rodent-personality">
        <div className="engine-section">
          <div className="engine-section-header">
            <span className="engine-section-label">{t('engine.rodent.personality')}</span>
            <select
              className="engine-select"
              value={engine.rodentPersonality}
              onChange={(e) => engine.setRodentPersonality(e.target.value)}
              style={{ minWidth: 140 }}
            >
              {RODENT_PERSONALITY_GROUPS.map((group) => (
                <optgroup key={group.labelKey} label={t(group.labelKey)}>
                  {group.options.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <span className="engine-desc">{t('engine.rodent.personalityDesc')}</span>
        </div>
      </EditableComponent>
    </div>
  );
}

