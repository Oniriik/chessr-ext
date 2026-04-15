import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Puzzle, LogOut, Loader2, Play, Lightbulb, CheckCircle2, Lock, Sparkles, Zap, Monitor } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Slider } from '../ui/slider';
import { AuthForm } from '../auth';
import { useAuthStore } from '../../stores/authStore';
import { useUpgradeModal } from '../UpgradeModal';
import { usePuzzleStore, type PuzzleSearchMode, type PuzzleEngine } from '../../stores/puzzleStore';
import { useWebSocketStore } from '../../stores/webSocketStore';
import { useMaiaWebSocketStore } from '../../stores/maiaWebSocketStore';
import { getPlayerColorFromDOM as chesscomGetPlayerColor } from '../../lib/chesscom/extractFenFromBoard';
import { extractFenFromBoard as lichessExtractFen, getPlayerColorFromDOM as lichessGetPlayerColor, detectPuzzleStarted as lichessDetectStarted, detectPuzzleSolved as lichessDetectSolved } from '../../lib/lichess/puzzleFen';
import { usePuzzleSuggestionTrigger } from '../../hooks/usePuzzleSuggestionTrigger';
import { usePuzzleArrowRenderer } from '../../hooks/usePuzzleArrowRenderer';
import { usePlatform } from '../../contexts/PlatformContext';
import { logger } from '../../lib/logger';
import { usePlanLimits } from '../../lib/planUtils';
import { useStreamerModeStore } from '../../stores/streamerModeStore';

/**
 * Hook that detects puzzle state and syncs with puzzle store
 * Platform-aware: uses Chess.com or Lichess extractors based on current platform
 */
function usePuzzleDetection() {
  const { isStarted, isSolved, playerColor, setStarted, setSolved, setFen } = usePuzzleStore();
  const { platform } = usePlatform();
  const isLichess = platform.id === 'lichess';

  const detect = useCallback(() => {
    if (isLichess) {
      // --- Lichess detection ---
      const newIsSolved = lichessDetectSolved();
      if (newIsSolved !== isSolved) {
        logger.log(`[puzzle-detect-lichess] Solved state changed: ${newIsSolved}`);
        setSolved(newIsSolved);
      }

      if (newIsSolved) return;

      const newIsStarted = lichessDetectStarted();
      const newPlayerColor = lichessGetPlayerColor();

      if (newIsStarted !== isStarted || newPlayerColor !== playerColor) {
        logger.log(`[puzzle-detect-lichess] State changed: isStarted=${newIsStarted}, playerColor=${newPlayerColor}`);
        setStarted(newIsStarted, newPlayerColor);
      }

      if (newIsStarted) {
        const fen = lichessExtractFen();
        if (fen) {
          const fenPosition = fen.split(' ')[0];
          const fenTurn = fen.split(' ')[1];
          logger.log(`[puzzle-detect-lichess] FEN extracted: turn=${fenTurn}, position=${fenPosition.substring(0, 20)}...`);
        }
        setFen(fen);
      }
    } else {
      // --- Chess.com detection ---
      const solvedElement = !!document.querySelector('.coach-dialogue-solved');
      if (solvedElement !== isSolved) {
        logger.log(`[puzzle-detect] Solved state changed: ${solvedElement}`);
        setSolved(solvedElement);
      }

      if (solvedElement) return;

      const toMoveHeading = document.querySelector('[data-cy="to-move-section-heading"]');
      const coachFeedback = document.querySelector('.coach-feedback-detail-colorToMove, .cc-coach-feedback-detail-colorToMove');
      const dailyColorIndicator = document.querySelector('.message-color-to-move-square');
      const rushHeading = document.querySelector('.section-heading-component.section-heading-lightGrey, .section-heading-component.section-heading-black');
      const newIsStarted = !!(toMoveHeading || coachFeedback || dailyColorIndicator || rushHeading);

      const newPlayerColor = chesscomGetPlayerColor();

      if (newIsStarted !== isStarted || newPlayerColor !== playerColor) {
        logger.log(`[puzzle-detect] State changed: isStarted=${newIsStarted}, playerColor=${newPlayerColor}`);
        setStarted(newIsStarted, newPlayerColor);
      }

      // Chess.com FEN comes from pageContext.js via chessr:boardFen message
    }
  }, [isStarted, isSolved, playerColor, isLichess, setStarted, setSolved, setFen]);

  useEffect(() => {
    // Initial detection
    detect();

    // Observe DOM changes for puzzle state (started/solved/playerColor)
    const observer = new MutationObserver(() => {
      detect();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    // Chess.com: listen for FEN from pageContext.js bridge (uses game.getFEN())
    const handleBoardFen = (e: MessageEvent) => {
      if (e.data?.type === 'chessr:boardFen' && e.data.fen && !isLichess) {
        logger.log(`[puzzle-detect] FEN from pageContext: ${e.data.fen}`);
        setFen(e.data.fen);
      }
    };
    window.addEventListener('message', handleBoardFen);

    return () => {
      observer.disconnect();
      window.removeEventListener('message', handleBoardFen);
    };
  }, [detect, isLichess, setFen]);

  return { isStarted, isSolved, playerColor };
}

/**
 * Convert UCI move (e.g., "e2e4") to readable format (e.g., "e2 → e4")
 */
function formatMove(uciMove: string): string {
  if (uciMove.length < 4) return uciMove;
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? `=${uciMove[4].toUpperCase()}` : '';
  return `${from} → ${to}${promotion}`;
}

function PuzzleStatusCard({ isStarted, isSolved, playerColor }: { isStarted: boolean; isSolved: boolean; playerColor: 'white' | 'black' | null }) {
  const { suggestion, autoHint, isLoading } = usePuzzleStore();
  const { t } = useTranslation(['puzzles', 'common', 'game']);

  // Solved state
  if (isSolved) {
    return (
      <Card className="tw-bg-green-500/10 tw-border-green-500/30">
        <CardContent className="tw-py-4 tw-px-4">
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-green-500/20">
              <CheckCircle2 className="tw-w-5 tw-h-5 tw-text-green-500" />
            </div>
            <div className="tw-text-left">
              <p className="tw-text-sm tw-font-medium tw-text-green-500">
                {t('puzzles:puzzleSolved')}
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('puzzles:greatJob')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isStarted) {
    return (
      <Card className="tw-bg-muted/30 tw-border-dashed">
        <CardContent className="tw-py-4 tw-px-4">
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-primary/10">
              <Play className="tw-w-5 tw-h-5 tw-text-primary" />
            </div>
            <div className="tw-text-left">
              <p className="tw-text-sm tw-font-medium tw-text-foreground">
                {t('common:readyToPlay')}
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('puzzles:startPuzzle')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const colorLabel = playerColor === 'white' ? t('common:white') : t('common:black');

  // Determine what to show in the badge
  let badgeContent: React.ReactNode;
  let badgeStyle = 'tw-bg-primary/15 tw-text-primary';

  if (suggestion) {
    // Show the move
    badgeContent = (
      <>
        <Lightbulb className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">{formatMove(suggestion.move)}</span>
      </>
    );
    badgeStyle = 'tw-bg-green-500/15 tw-text-green-500';
  } else if (isLoading) {
    // Loading
    badgeContent = (
      <>
        <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin" />
        <span className="tw-text-xs tw-font-medium">{t('game:analyzing')}</span>
      </>
    );
  } else if (!autoHint) {
    // Auto hint disabled, waiting for manual trigger
    badgeContent = (
      <>
        <Puzzle className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">{t('puzzles:clickHintBelow')}</span>
      </>
    );
    badgeStyle = 'tw-bg-muted tw-text-muted-foreground';
  } else {
    // Auto hint enabled, waiting
    badgeContent = (
      <>
        <Puzzle className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">{t('puzzles:waiting')}</span>
      </>
    );
  }

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-py-3 tw-px-4">
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-2.5">
            <div className={`tw-w-6 tw-h-6 tw-rounded-sm tw-ring-2 tw-ring-primary tw-ring-offset-1 tw-ring-offset-background ${
              playerColor === 'white' ? 'tw-bg-white' : 'tw-bg-zinc-800'
            }`} />
            <div className="tw-leading-tight">
              <p className="tw-text-xs tw-text-muted-foreground">{t('common:youPlay')}</p>
              <p className="tw-text-sm tw-font-semibold">{colorLabel}</p>
            </div>
          </div>
          <div className={`tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-rounded-full ${badgeStyle}`}>
            {badgeContent}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


function formatSearchValue(mode: PuzzleSearchMode, nodes: number, depth: number, movetime: number) {
  switch (mode) {
    case 'nodes': return nodes >= 1_000_000 ? `${(nodes / 1_000_000).toFixed(1)}M` : `${(nodes / 1000).toFixed(0)}k`;
    case 'depth': return `${depth}`;
    case 'movetime': return `${(movetime / 1000).toFixed(1)}s`;
  }
}

function PuzzleControls({ triggerHint }: { triggerHint: () => void }) {
  const {
    autoHint, setAutoHint, autoPlay, setAutoPlay, isLoading, isStarted,
    puzzleEngine, setPuzzleEngine,
    searchMode, setSearchMode, searchNodes, setSearchNodes,
    searchDepth, setSearchDepth, searchMovetime, setSearchMovetime,
  } = usePuzzleStore();
  const { isConnected: isServerConnected } = useWebSocketStore();
  const { isConnected: isMaiaConnected, isConnecting: isMaiaConnecting } = useMaiaWebSocketStore();
  const { canUsePuzzleHints } = usePlanLimits();
  const { t } = useTranslation(['puzzles', 'common', 'game', 'engine', 'settings']);

  const isMaia = puzzleEngine === 'maia2';
  const isConnected = isMaia ? isMaiaConnected : isServerConnected;

  if (!isStarted) return null;

  // Show upgrade prompt for free users
  if (!canUsePuzzleHints) {
    return (
      <Card className="tw-mt-3 tw-bg-gradient-to-br tw-from-yellow-500/10 tw-to-orange-500/10 tw-border-yellow-500/20">
        <CardContent className="tw-py-4 tw-px-4 tw-space-y-3">
          <div className="tw-flex tw-items-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-yellow-500/20">
              <Lock className="tw-w-5 tw-h-5 tw-text-yellow-500" />
            </div>
            <div>
              <p className="tw-text-sm tw-font-medium tw-text-foreground">
                {t('puzzles:puzzleHints')}
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('puzzles:upgradePuzzleSuggestions')}
              </p>
            </div>
          </div>
          <Button
            onClick={() => useUpgradeModal.getState().open()}
            className="tw-w-full tw-bg-gradient-to-r tw-from-yellow-500 tw-to-orange-500 hover:tw-from-yellow-600 hover:tw-to-orange-600 tw-text-black tw-font-medium"
            size="sm"
          >
            <Sparkles className="tw-w-4 tw-h-4 tw-mr-2" />
            {t('common:upgradeNow')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="tw-mt-3">
      <CardContent className="tw-py-3 tw-px-4 tw-space-y-3">
        {/* Engine selector */}
        <div className="tw-flex tw-items-center tw-justify-between">
          <span className="tw-text-sm tw-font-medium">{t('game:engine')}</span>
          <select
            value={puzzleEngine}
            onChange={(e) => setPuzzleEngine(e.target.value as PuzzleEngine)}
            className="tw-h-8 tw-px-3 tw-py-1 tw-text-xs tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer"
          >
            <option value="komodo">{t('puzzles:komodoDragon')}</option>
            <option value="maia2">{t('settings:maia2Local')}</option>
          </select>
        </div>

        {/* Maia connection status */}
        {isMaia && (
          <div className="tw-flex tw-items-center tw-gap-2">
            <span
              className={`tw-h-2 tw-w-2 tw-rounded-full ${
                isMaiaConnected
                  ? 'tw-bg-green-500'
                  : isMaiaConnecting
                    ? 'tw-bg-yellow-500 tw-animate-pulse'
                    : 'tw-bg-red-500'
              }`}
            />
            <span className="tw-text-xs tw-text-muted-foreground">
              {isMaiaConnected ? t('puzzles:maiaConnectedFull') : isMaiaConnecting ? t('puzzles:connectingToMaia') : t('puzzles:maiaDisconnected')}
            </span>
          </div>
        )}

        {/* Auto hint toggle */}
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Lightbulb className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
            <span className="tw-text-sm tw-text-foreground">{t('puzzles:autoHint')}</span>
          </div>
          <Switch
            checked={autoHint}
            onCheckedChange={setAutoHint}
          />
        </div>

        {/* Auto play toggle (requires auto hint) */}
        {autoHint && (
          <div className="tw-flex tw-items-center tw-justify-between">
            <div className="tw-flex tw-items-center tw-gap-2">
              <Zap className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
              <span className="tw-text-sm tw-text-foreground">{t('puzzles:autoPlay')}</span>
            </div>
            <Switch
              checked={autoPlay}
              onCheckedChange={setAutoPlay}
            />
          </div>
        )}

        {/* Search mode selector (Komodo only) */}
        {!isMaia && (
          <div className="tw-space-y-2">
            <div className="tw-flex tw-items-center tw-justify-between">
              <div className="tw-flex tw-items-center tw-gap-2">
                <select
                  value={searchMode}
                  onChange={(e) => setSearchMode(e.target.value as PuzzleSearchMode)}
                  className="tw-h-7 tw-px-2 tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-xs"
                >
                  <option value="nodes">{t('engine:nodes')}</option>
                  <option value="depth">{t('engine:depth')}</option>
                  <option value="movetime">{t('engine:moveTime')}</option>
                </select>
              </div>
              <span className="tw-text-base tw-font-bold tw-text-primary">
                {formatSearchValue(searchMode, searchNodes, searchDepth, searchMovetime)}
              </span>
            </div>
            {searchMode === 'nodes' && (
              <Slider
                value={[searchNodes]}
                onValueChange={([value]) => setSearchNodes(value)}
                min={100000}
                max={5000000}
                step={100000}
              />
            )}
            {searchMode === 'depth' && (
              <Slider
                value={[searchDepth]}
                onValueChange={([value]) => setSearchDepth(value)}
                min={1}
                max={30}
                step={1}
              />
            )}
            {searchMode === 'movetime' && (
              <Slider
                value={[searchMovetime]}
                onValueChange={([value]) => setSearchMovetime(value)}
                min={500}
                max={5000}
                step={100}
              />
            )}
          </div>
        )}

        {/* Manual hint button */}
        {!autoHint && (
          <Button
            onClick={triggerHint}
            disabled={isLoading || !isConnected}
            className="tw-w-full"
            size="sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="tw-w-4 tw-h-4 tw-mr-2 tw-animate-spin" />
                {t('common:loading')}
              </>
            ) : (
              <>
                <Lightbulb className="tw-w-4 tw-h-4 tw-mr-2" />
                {t('puzzles:showHint')}
              </>
            )}
          </Button>
        )}

        {!isConnected && !isMaia && (
          <p className="tw-text-xs tw-text-muted-foreground tw-text-center">
            {t('puzzles:connectingToServer')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PuzzleHeader() {
  const { signOut } = useAuthStore();
  const { t } = useTranslation('common');

  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-mb-4">
      <div className="tw-flex tw-items-center tw-gap-2">
        <img
          src={chrome.runtime.getURL('icons/icon48.png')}
          alt="Chessr"
          className="tw-w-8 tw-h-8"
        />
        <span className="tw-text-lg tw-font-semibold">Chessr.io</span>
        <span className="tw-text-xs tw-text-muted-foreground tw-bg-muted tw-px-2 tw-py-0.5 tw-rounded">
          {t('common:puzzle')}
        </span>
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => chrome.runtime.sendMessage({ type: 'open_streamer' })}
          className="tw-h-8 tw-w-8"
          title="Streamer Mode"
        >
          <Monitor className="tw-h-4 tw-w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          className="tw-h-8 tw-w-8"
          title={t('common:signOut')}
        >
          <LogOut className="tw-h-4 tw-w-4" />
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedPuzzleContent({ hidden }: { hidden?: boolean }) {
  const { isStarted, isSolved, playerColor } = usePuzzleDetection();
  const { init, connect } = useWebSocketStore();
  const { canUsePuzzleHints } = usePlanLimits();
  const { t } = useTranslation(['puzzles', 'common']);

  // Initialize WebSocket manager and connect
  useEffect(() => {
    init();
    connect();
  }, [init, connect]);

  // Render hint arrows on the board (only for premium) — skip in streamer mode
  usePuzzleArrowRenderer(hidden);

  // Auto-trigger suggestions when FEN changes (must run even in streamer mode)
  const triggerHint = usePuzzleSuggestionTrigger();

  // In streamer mode, keep hooks running but hide UI
  if (hidden) return null;

  // Free users: show only upgrade card
  if (!canUsePuzzleHints) {
    return (
      <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-flex-col">
        <PuzzleHeader />
        <div className="tw-flex-1 tw-flex tw-flex-col tw-justify-center">
          <Card className="tw-bg-gradient-to-br tw-from-yellow-500/10 tw-to-orange-500/10 tw-border-yellow-500/20">
            <CardContent className="tw-py-6 tw-px-4 tw-space-y-4">
              <div className="tw-flex tw-flex-col tw-items-center tw-text-center tw-gap-3">
                <div className="tw-p-3 tw-rounded-xl tw-bg-yellow-500/20">
                  <Puzzle className="tw-w-8 tw-h-8 tw-text-yellow-500" />
                </div>
                <div>
                  <p className="tw-text-base tw-font-semibold tw-text-foreground">
                    {t('puzzles:puzzleHints')}
                  </p>
                  <p className="tw-text-sm tw-text-muted-foreground tw-mt-1">
                    {t('puzzles:getBestMove')}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => useUpgradeModal.getState().open()}
                className="tw-w-full tw-bg-gradient-to-r tw-from-yellow-500 tw-to-orange-500 hover:tw-from-yellow-600 hover:tw-to-orange-600 tw-text-black tw-font-medium"
              >
                <Sparkles className="tw-w-4 tw-h-4 tw-mr-2" />
                {t('common:upgradeToUnlock')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </Card>
    );
  }

  return (
    <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-flex-col">
      <PuzzleHeader />
      <div className="tw-flex-1 tw-flex tw-flex-col">
        <PuzzleStatusCard isStarted={isStarted} isSolved={isSolved} playerColor={playerColor} />
        <PuzzleControls triggerHint={triggerHint} />
      </div>
    </Card>
  );
}

export function PuzzleSidebar() {
  const { user, initializing, initialize } = useAuthStore();
  const isStreamerTabOpen = useStreamerModeStore((s) => s.isStreamerTabOpen);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // In streamer mode: still render AuthenticatedPuzzleContent (so hooks run)
  // but pass hidden=true to skip UI rendering
  if (isStreamerTabOpen) {
    return user ? <AuthenticatedPuzzleContent hidden /> : null;
  }

  return (
    <div id="chessr-root" className="tw-h-[400px]">
      {initializing ? (
        <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-items-center tw-justify-center">
          <Loader2 className="tw-w-6 tw-h-6 tw-animate-spin tw-text-primary" />
        </Card>
      ) : user ? (
        <AuthenticatedPuzzleContent />
      ) : (
        <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-flex-col">
          <AuthForm compact />
        </Card>
      )}
    </div>
  );
}
