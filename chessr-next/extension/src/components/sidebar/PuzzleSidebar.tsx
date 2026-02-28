import { useEffect, useCallback } from 'react';
import { Puzzle, LogOut, Loader2, Play, Lightbulb, CheckCircle2, Lock, Sparkles } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Slider } from '../ui/slider';
import { AuthForm } from '../auth';
import { useAuthStore } from '../../stores/authStore';
import { usePuzzleStore, type PuzzleSearchMode } from '../../stores/puzzleStore';
import { useWebSocketStore } from '../../stores/webSocketStore';
import { extractFenFromBoard, getPlayerColorFromDOM } from '../../lib/chesscom/extractFenFromBoard';
import { usePuzzleSuggestionTrigger } from '../../hooks/usePuzzleSuggestionTrigger';
import { usePuzzleArrowRenderer } from '../../hooks/usePuzzleArrowRenderer';
import { logger } from '../../lib/logger';
import { usePlanLimits } from '../../lib/planUtils';

/**
 * Hook that detects puzzle state and syncs with puzzle store
 */
function usePuzzleDetection() {
  const { isStarted, isSolved, playerColor, setStarted, setSolved, setFen } = usePuzzleStore();

  const detect = useCallback(() => {
    // Check if puzzle is solved
    const solvedElement = !!document.querySelector('.coach-dialogue-solved');
    if (solvedElement !== isSolved) {
      logger.log(`[puzzle-detect] Solved state changed: ${solvedElement}`);
      setSolved(solvedElement);
    }

    // If solved, don't process further
    if (solvedElement) {
      return;
    }

    // Method 1: Learning puzzles have the "to move" heading
    const toMoveHeading = document.querySelector('[data-cy="to-move-section-heading"]');
    // Method 2: Rated puzzles have the coach feedback element
    const coachFeedback = document.querySelector('.cc-coach-feedback-detail-colorToMove');
    // Method 3: Daily puzzles have the message color indicator
    const dailyColorIndicator = document.querySelector('.message-color-to-move-square');
    // Method 4: Puzzle rush has section heading with color
    const rushHeading = document.querySelector('.section-heading-component.section-heading-lightGrey, .section-heading-component.section-heading-black');
    const newIsStarted = !!(toMoveHeading || coachFeedback || dailyColorIndicator || rushHeading);

    // Detect player color
    const newPlayerColor = getPlayerColorFromDOM();

    // Update store if changed
    if (newIsStarted !== isStarted || newPlayerColor !== playerColor) {
      logger.log(`[puzzle-detect] State changed: isStarted=${newIsStarted}, playerColor=${newPlayerColor}`);
      setStarted(newIsStarted, newPlayerColor);
    }

    // Extract FEN if puzzle is started
    if (newIsStarted) {
      const fen = extractFenFromBoard();
      if (fen) {
        const fenPosition = fen.split(' ')[0];
        const fenTurn = fen.split(' ')[1];
        logger.log(`[puzzle-detect] FEN extracted: turn=${fenTurn}, position=${fenPosition.substring(0, 20)}...`);
      }
      setFen(fen);
    }
  }, [isStarted, isSolved, playerColor, setStarted, setSolved, setFen]);

  useEffect(() => {
    // Initial detection
    detect();

    // Observe DOM changes for puzzle state
    const observer = new MutationObserver(() => {
      detect();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, [detect]);

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
                Puzzle Solved!
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                Great job! Try the next one
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
                Ready to play
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                Start a puzzle to get suggestions
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const colorLabel = playerColor === 'white' ? 'White' : 'Black';

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
        <span className="tw-text-xs tw-font-medium">Analyzing...</span>
      </>
    );
  } else if (!autoHint) {
    // Auto hint disabled, waiting for manual trigger
    badgeContent = (
      <>
        <Puzzle className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">Click hint below</span>
      </>
    );
    badgeStyle = 'tw-bg-muted tw-text-muted-foreground';
  } else {
    // Auto hint enabled, waiting
    badgeContent = (
      <>
        <Puzzle className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">Waiting...</span>
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
              <p className="tw-text-xs tw-text-muted-foreground">You play</p>
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

const UPGRADE_URL = 'https://discord.gg/72j4dUadTu';

function formatSearchValue(mode: PuzzleSearchMode, nodes: number, depth: number, movetime: number) {
  switch (mode) {
    case 'nodes': return nodes >= 1_000_000 ? `${(nodes / 1_000_000).toFixed(1)}M` : `${(nodes / 1000).toFixed(0)}k`;
    case 'depth': return `${depth}`;
    case 'movetime': return `${(movetime / 1000).toFixed(1)}s`;
  }
}

function PuzzleControls() {
  const {
    autoHint, setAutoHint, isLoading, isStarted,
    searchMode, setSearchMode, searchNodes, setSearchNodes,
    searchDepth, setSearchDepth, searchMovetime, setSearchMovetime,
  } = usePuzzleStore();
  const { isConnected } = useWebSocketStore();
  const triggerHint = usePuzzleSuggestionTrigger();
  const { canUsePuzzleHints } = usePlanLimits();

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
                Puzzle Hints
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                Upgrade to unlock puzzle suggestions
              </p>
            </div>
          </div>
          <Button
            onClick={() => window.open(UPGRADE_URL, '_blank')}
            className="tw-w-full tw-bg-gradient-to-r tw-from-yellow-500 tw-to-orange-500 hover:tw-from-yellow-600 hover:tw-to-orange-600 tw-text-black tw-font-medium"
            size="sm"
          >
            <Sparkles className="tw-w-4 tw-h-4 tw-mr-2" />
            Upgrade Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="tw-mt-3">
      <CardContent className="tw-py-3 tw-px-4 tw-space-y-3">
        {/* Auto hint toggle */}
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Lightbulb className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
            <span className="tw-text-sm tw-text-foreground">Auto Hint</span>
          </div>
          <Switch
            checked={autoHint}
            onCheckedChange={setAutoHint}
          />
        </div>

        {/* Search mode selector */}
        <div className="tw-space-y-2">
          <div className="tw-flex tw-items-center tw-justify-between">
            <div className="tw-flex tw-items-center tw-gap-2">
              <select
                value={searchMode}
                onChange={(e) => setSearchMode(e.target.value as PuzzleSearchMode)}
                className="tw-h-7 tw-px-2 tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-xs"
              >
                <option value="nodes">Nodes</option>
                <option value="depth">Depth</option>
                <option value="movetime">Move Time</option>
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
                Loading...
              </>
            ) : (
              <>
                <Lightbulb className="tw-w-4 tw-h-4 tw-mr-2" />
                Show Hint
              </>
            )}
          </Button>
        )}

        {!isConnected && (
          <p className="tw-text-xs tw-text-muted-foreground tw-text-center">
            Connecting to server...
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PuzzleHeader() {
  const { signOut } = useAuthStore();

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
          Puzzle
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={signOut}
        className="tw-h-8 tw-w-8"
        title="Sign out"
      >
        <LogOut className="tw-h-4 tw-w-4" />
      </Button>
    </div>
  );
}

function AuthenticatedPuzzleContent() {
  const { isStarted, isSolved, playerColor } = usePuzzleDetection();
  const { init, connect } = useWebSocketStore();
  const { canUsePuzzleHints } = usePlanLimits();

  // Initialize WebSocket manager and connect
  useEffect(() => {
    init();
    connect();
  }, [init, connect]);

  // Render hint arrows on the board (only for premium)
  usePuzzleArrowRenderer();

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
                    Puzzle Hints
                  </p>
                  <p className="tw-text-sm tw-text-muted-foreground tw-mt-1">
                    Get the best move for any puzzle
                  </p>
                </div>
              </div>
              <Button
                onClick={() => window.open(UPGRADE_URL, '_blank')}
                className="tw-w-full tw-bg-gradient-to-r tw-from-yellow-500 tw-to-orange-500 hover:tw-from-yellow-600 hover:tw-to-orange-600 tw-text-black tw-font-medium"
              >
                <Sparkles className="tw-w-4 tw-h-4 tw-mr-2" />
                Upgrade to Unlock
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
        <PuzzleControls />
      </div>
    </Card>
  );
}

export function PuzzleSidebar() {
  const { user, initializing, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

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
