import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Chess } from 'chess.js';
import { useSuggestions, useIsSuggestionLoading, useSuggestedFen, useSelectedSuggestionIndex, useSetSelectedSuggestionIndex, useSetHoveredSuggestionIndex, useShowingPvIndex, useSetShowingPvIndex, useShowingOpeningMoves, useSetShowingOpeningMoves, useShowingAlternativeIndex, useSetShowingAlternativeIndex, type Suggestion, type ConfidenceLabel } from '../../stores/suggestionStore';
import { useGameStore } from '../../stores/gameStore';
import { useOpeningStore, type SavedOpening } from '../../stores/openingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useOpeningTracker } from '../../hooks/useOpeningTracker';
import { useAlternativeOpenings } from '../../hooks/useAlternativeOpenings';
import { OpeningSuggestionCard } from './OpeningSuggestionCard';
import { Button } from '../ui/button';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import type { OpeningWithStats } from '../../lib/openingsDatabase';

/**
 * Convert hex color to rgba
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Confidence label display config with background colors like old version
const CONFIDENCE_CONFIG: Record<ConfidenceLabel, { label: string; bgClass: string; textClass: string }> = {
  very_reliable: { label: 'Best', bgClass: 'tw-bg-green-500/20', textClass: 'tw-text-green-400' },
  reliable: { label: 'Safe', bgClass: 'tw-bg-blue-500/20', textClass: 'tw-text-blue-400' },
  playable: { label: 'OK', bgClass: 'tw-bg-gray-500/20', textClass: 'tw-text-gray-300' },
  risky: { label: 'Risky', bgClass: 'tw-bg-orange-500/20', textClass: 'tw-text-orange-400' },
  speculative: { label: 'Risky', bgClass: 'tw-bg-red-500/20', textClass: 'tw-text-red-400' },
};

// Piece symbols for capture badges
const PIECE_SYMBOLS: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

// Piece names for promotion badges
const PIECE_NAMES: Record<string, string> = {
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
};

interface MoveFlags {
  isCheck: boolean;
  isMate: boolean;
  isCapture: boolean;
  capturedPiece?: string;
  isPromotion: boolean;
  promotionPiece?: string;
}

// Compute flags for a move using chess.js
function computeMoveFlags(fen: string, moveUci: string): MoveFlags {
  try {
    const chess = new Chess(fen);
    const from = moveUci.slice(0, 2);
    const to = moveUci.slice(2, 4);
    const promotion = moveUci.length === 5 ? moveUci[4] : undefined;

    const move = chess.move({ from, to, promotion });
    if (!move) {
      return { isCheck: false, isMate: false, isCapture: false, isPromotion: false };
    }

    return {
      isCheck: chess.isCheck(),
      isMate: chess.isCheckmate(),
      isCapture: !!move.captured,
      capturedPiece: move.captured,
      isPromotion: !!move.promotion,
      promotionPiece: move.promotion,
    };
  } catch {
    return { isCheck: false, isMate: false, isCapture: false, isPromotion: false };
  }
}

// Convert UCI moves to SAN notation for display
function convertPvToSan(fen: string, pvUci: string[]): string[] {
  try {
    const chess = new Chess(fen);
    const sanMoves: string[] = [];

    for (const uci of pvUci) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length === 5 ? uci[4] : undefined;

      const move = chess.move({ from, to, promotion });
      if (!move) break;
      sanMoves.push(move.san);
    }

    return sanMoves;
  } catch {
    return pvUci; // Fallback to UCI if conversion fails
  }
}

function formatEval(evaluation: number, mateScore: number | undefined, playerColor: 'white' | 'black' | null): string {
  // Flip eval to player's perspective (positive = good for player)
  const isBlack = playerColor === 'black';
  // Convert from centipawns to pawns (divide by 100)
  const evalInPawns = evaluation / 100;
  const adjustedEval = isBlack ? -evalInPawns : evalInPawns;
  const adjustedMate = mateScore !== undefined && mateScore !== null ? (isBlack ? -mateScore : mateScore) : undefined;

  if (adjustedMate !== undefined) {
    return `M${Math.abs(adjustedMate)}`;
  }
  // Regular eval in pawns
  if (Math.abs(adjustedEval) < 0.05) {
    return '0.0';
  }
  const sign = adjustedEval > 0 ? '+' : '';
  return `${sign}${adjustedEval.toFixed(1)}`;
}

function getEvalColorClass(evaluation: number, mateScore: number | undefined, playerColor: 'white' | 'black' | null): string {
  // When playing black, flip the color logic (negative = good for black)
  const isBlack = playerColor === 'black';

  if (mateScore !== undefined && mateScore !== null) {
    const isGood = isBlack ? mateScore < 0 : mateScore > 0;
    return isGood ? 'tw-text-green-400' : 'tw-text-red-400';
  }
  // Evaluation is in centipawns, 5cp threshold for "equal"
  if (Math.abs(evaluation) < 5) return 'tw-text-gray-400';

  const isGood = isBlack ? evaluation < 0 : evaluation > 0;
  return isGood ? 'tw-text-green-400' : 'tw-text-red-400';
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  rank: number;
  isSelected: boolean;
  isShowingPv: boolean;
  flags: MoveFlags;
  fen: string;
  playerColor: 'white' | 'black' | null;
  arrowColor: string;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onTogglePv: () => void;
  onPvHoverStart: () => void;
  onPvHoverEnd: () => void;
}

function SuggestionCard({ suggestion, rank, isSelected, isShowingPv, flags, fen, playerColor, arrowColor, onSelect, onHoverStart, onHoverEnd, onTogglePv, onPvHoverStart, onPvHoverEnd }: SuggestionCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const config = CONFIDENCE_CONFIG[suggestion.confidenceLabel];

  // Convert PV to SAN notation
  const pvSan = useMemo(() => {
    if (!suggestion.pv || suggestion.pv.length === 0) return [];
    return convertPvToSan(fen, suggestion.pv);
  }, [suggestion.pv, fen]);

  // Build effect badges
  const effectBadges: { label: string; bgClass: string; textClass: string }[] = [];

  if (suggestion.mateScore !== undefined && suggestion.mateScore !== null) {
    effectBadges.push({
      label: `Mate ${Math.abs(suggestion.mateScore)}`,
      bgClass: 'tw-bg-yellow-500/20',
      textClass: 'tw-text-yellow-400',
    });
  } else if (flags.isCheck) {
    effectBadges.push({
      label: 'Check',
      bgClass: 'tw-bg-yellow-500/20',
      textClass: 'tw-text-yellow-400',
    });
  }

  if (flags.isCapture && flags.capturedPiece) {
    effectBadges.push({
      label: `x ${PIECE_SYMBOLS[flags.capturedPiece] || ''}`,
      bgClass: 'tw-bg-white',
      textClass: 'tw-text-black',
    });
  }

  if (flags.isPromotion && flags.promotionPiece) {
    effectBadges.push({
      label: `${PIECE_SYMBOLS[flags.promotionPiece] || '♛'} ${PIECE_NAMES[flags.promotionPiece] || 'Queen'}`,
      bgClass: 'tw-bg-indigo-500/20',
      textClass: 'tw-text-indigo-400',
    });
  }

  return (
    <div
      className="tw-p-2 tw-rounded-md tw-border tw-cursor-pointer tw-transition-colors tw-bg-muted/50"
      style={{
        borderColor: isSelected ? arrowColor : isHovered ? hexToRgba(arrowColor, 0.6) : hexToRgba(arrowColor, 0.3),
      }}
      onClick={onSelect}
      onMouseEnter={() => { setIsHovered(true); onHoverStart(); }}
      onMouseLeave={() => { setIsHovered(false); onHoverEnd(); }}
    >
      {/* Header with move, badges, and eval */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-wrap">
          <span
            className="tw-text-xs tw-px-1 tw-py-0.5 tw-rounded tw-font-medium"
            style={{ backgroundColor: hexToRgba(arrowColor, 0.2), color: arrowColor }}
          >
            {rank}
          </span>
          <span className="tw-text-sm tw-font-medium" style={{ color: arrowColor }}>
            {suggestion.move}
          </span>
          {/* Quality badge inline */}
          <span className={`tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-medium ${config.bgClass} ${config.textClass}`}>
            {config.label}
          </span>
          {/* Effect badges inline */}
          {effectBadges.map((badge, i) => (
            <span
              key={i}
              className={`tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-medium ${badge.bgClass} ${badge.textClass}`}
            >
              {badge.label}
            </span>
          ))}
        </div>
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-shrink-0">
          <span className={`tw-text-sm tw-font-mono tw-font-semibold ${getEvalColorClass(suggestion.evaluation, suggestion.mateScore, playerColor)}`}>
            {formatEval(suggestion.evaluation, suggestion.mateScore, playerColor)}
          </span>
          {suggestion.pv && suggestion.pv.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePv();
              }}
              onMouseEnter={(e) => {
                e.stopPropagation();
                onPvHoverStart();
              }}
              onMouseLeave={(e) => {
                e.stopPropagation();
                onPvHoverEnd();
              }}
              className={`tw-h-6 tw-w-6 ${isShowingPv ? 'tw-text-accent-foreground tw-bg-accent' : 'tw-text-muted-foreground'}`}
              title={isShowingPv ? 'Hide line on board' : 'Show line on board'}
            >
              {isShowingPv ? <Eye className="tw-w-3.5 tw-h-3.5" /> : <EyeOff className="tw-w-3.5 tw-h-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* PV Line */}
      {pvSan.length > 1 && (
        <div className="tw-flex tw-items-center tw-gap-1 tw-mt-1.5 tw-flex-wrap">
          <span className="tw-text-[10px] tw-text-muted-foreground tw-uppercase tw-tracking-wide">
            Next
          </span>
          {pvSan.slice(1).map((move, i) => {
            const isWhiteMove = fen.includes(' w ') ? (i % 2 === 1) : (i % 2 === 0);
            return (
              <span
                key={i}
                className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-[10px] tw-px-1 tw-py-0.5 tw-rounded tw-bg-muted tw-text-muted-foreground tw-font-mono"
              >
                <span className={`tw-w-1.5 tw-h-1.5 tw-rounded-full ${isWhiteMove ? 'tw-bg-white' : 'tw-bg-gray-600'}`} />
                {move}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MoveListDisplay() {
  const { isGameStarted, playerColor, moveHistory } = useGameStore();
  const { setWhiteOpening, setBlackOpening, openingArrowColor } = useOpeningStore();
  const {
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
  } = useSettingsStore();
  const suggestions = useSuggestions();
  const suggestedFen = useSuggestedFen();
  const isLoading = useIsSuggestionLoading();
  const selectedIndex = useSelectedSuggestionIndex();
  const setSelectedIndex = useSetSelectedSuggestionIndex();
  const setHoveredIndex = useSetHoveredSuggestionIndex();
  const showingPvIndex = useShowingPvIndex();
  const setShowingPvIndex = useSetShowingPvIndex();
  const showingOpeningMoves = useShowingOpeningMoves();
  const setShowingOpeningMoves = useSetShowingOpeningMoves();
  const showingAlternativeIndex = useShowingAlternativeIndex();
  const setShowingAlternativeIndex = useSetShowingAlternativeIndex();
  const openingTracker = useOpeningTracker();

  // Fetch alternative openings when deviated
  const { alternatives, isLoading: isLoadingAlternatives } = useAlternativeOpenings(
    openingTracker.hasDeviated
  );

  // Handler for selecting an alternative opening
  const handleSelectAlternative = useCallback(
    (opening: OpeningWithStats) => {
      const saved: SavedOpening = {
        name: opening.name,
        moves: opening.moves,
        eco: opening.eco,
        totalGames: opening.totalGames,
      };

      if (playerColor === 'white') {
        setWhiteOpening(saved);
      } else {
        setBlackOpening(saved);
      }
      // Clear the preview when selecting
      setShowingAlternativeIndex(null);
    },
    [playerColor, setWhiteOpening, setBlackOpening, setShowingAlternativeIndex]
  );

  // Track if alternative preview is "locked" (clicked) vs just hover preview
  const lockedAlternativeIndexRef = useRef<number | null>(null);

  // Handler for toggling alternative preview (click)
  const handleToggleAlternativePreview = useCallback(
    (index: number) => {
      if (lockedAlternativeIndexRef.current === index) {
        // Unlock
        lockedAlternativeIndexRef.current = null;
        setShowingAlternativeIndex(null);
      } else {
        // Lock to this index
        lockedAlternativeIndexRef.current = index;
        setShowingAlternativeIndex(index);
      }
    },
    [setShowingAlternativeIndex]
  );

  // Handler for alternative hover start
  const handleHoverAlternativeStart = useCallback(
    (index: number) => {
      if (lockedAlternativeIndexRef.current === null) {
        setShowingAlternativeIndex(index);
      }
    },
    [setShowingAlternativeIndex]
  );

  // Handler for alternative hover end
  const handleHoverAlternativeEnd = useCallback(() => {
    if (lockedAlternativeIndexRef.current === null) {
      setShowingAlternativeIndex(null);
    }
  }, [setShowingAlternativeIndex]);

  // Auto-accept alternative when player plays its next move
  useEffect(() => {
    // Only check when deviated and we have alternatives
    if (!openingTracker.hasDeviated || alternatives.length === 0 || moveHistory.length === 0) {
      return;
    }

    // Get the last move played
    const lastMove = moveHistory[moveHistory.length - 1];
    if (!lastMove) return;

    // Check each alternative to see if the last move matches its next expected move
    for (const alt of alternatives) {
      const altMoves = alt.moves
        .replace(/\d+\.\s*/g, '')
        .split(/\s+/)
        .filter((m: string) => m.length > 0);

      // Get the expected next move for this alternative (at currentMoveIndex)
      const nextMoveIndex = openingTracker.currentMoveIndex;
      if (nextMoveIndex < altMoves.length) {
        const expectedMove = altMoves[nextMoveIndex];
        if (lastMove === expectedMove) {
          // Player played this alternative's move - auto-accept it
          const saved: SavedOpening = {
            name: alt.name,
            moves: alt.moves,
            eco: alt.eco,
            totalGames: alt.totalGames,
          };

          if (playerColor === 'white') {
            setWhiteOpening(saved);
          } else {
            setBlackOpening(saved);
          }
          // Clear the preview
          setShowingAlternativeIndex(null);
          break; // Only accept the first matching alternative
        }
      }
    }
  }, [moveHistory, openingTracker.hasDeviated, openingTracker.currentMoveIndex, alternatives, playerColor, setWhiteOpening, setBlackOpening, setShowingAlternativeIndex]);

  // Track if PV is "locked" (clicked) vs just hover preview
  const lockedPvIndexRef = useRef<number | null>(null);

  // Track if opening moves preview is "locked" (clicked) vs just hover preview
  const lockedOpeningMovesRef = useRef<boolean>(false);

  // Store stable opening values that only update when suggestions are refreshed
  // or when the selected opening changes (e.g., user selects an alternative)
  const stableOpeningRef = useRef<{
    openingMoves: string[];
    nextMove: string | null;
    currentMoveIndex: number;
    lastSuggestedFen: string | null;
    lastOpeningName: string | null;
  }>({
    openingMoves: [],
    nextMove: null,
    currentMoveIndex: 0,
    lastSuggestedFen: null,
    lastOpeningName: null,
  });

  // Update stable values when suggestedFen changes (new suggestions arrived)
  // OR when the selected opening changes (user selected an alternative)
  const currentOpeningName = openingTracker.selectedOpening?.name ?? null;
  const openingChanged = currentOpeningName !== stableOpeningRef.current.lastOpeningName;
  const fenChanged = suggestedFen && suggestedFen !== stableOpeningRef.current.lastSuggestedFen;

  if (fenChanged || openingChanged) {
    stableOpeningRef.current = {
      openingMoves: openingTracker.openingMoves,
      nextMove: openingTracker.nextOpeningMove,
      currentMoveIndex: openingTracker.currentMoveIndex,
      lastSuggestedFen: suggestedFen,
      lastOpeningName: currentOpeningName,
    };
  }

  const handlePvToggle = (index: number) => {
    if (lockedPvIndexRef.current === index) {
      // Unlock
      lockedPvIndexRef.current = null;
      setShowingPvIndex(null);
    } else {
      // Lock to this index
      lockedPvIndexRef.current = index;
      setShowingPvIndex(index);
    }
  };

  const handlePvHoverStart = (index: number) => {
    // Only show preview if not locked to a different index
    if (lockedPvIndexRef.current === null) {
      setShowingPvIndex(index);
    }
  };

  const handlePvHoverEnd = () => {
    // Only hide if not locked
    if (lockedPvIndexRef.current === null) {
      setShowingPvIndex(null);
    }
  };

  // Opening moves toggle (click)
  const handleOpeningMovesToggle = () => {
    if (lockedOpeningMovesRef.current) {
      // Unlock
      lockedOpeningMovesRef.current = false;
      setShowingOpeningMoves(false);
    } else {
      // Lock
      lockedOpeningMovesRef.current = true;
      setShowingOpeningMoves(true);
    }
  };

  // Opening moves hover start
  const handleOpeningMovesHoverStart = () => {
    if (!lockedOpeningMovesRef.current) {
      setShowingOpeningMoves(true);
    }
  };

  // Opening moves hover end
  const handleOpeningMovesHoverEnd = () => {
    if (!lockedOpeningMovesRef.current) {
      setShowingOpeningMoves(false);
    }
  };

  // Compute flags for all suggestions
  const suggestionsWithFlags = useMemo(() => {
    if (!suggestedFen) return suggestions.map(s => ({ suggestion: s, flags: { isCheck: false, isMate: false, isCapture: false, isPromotion: false } as MoveFlags }));
    return suggestions.map(s => ({
      suggestion: s,
      flags: computeMoveFlags(suggestedFen, s.move),
    }));
  }, [suggestions, suggestedFen]);

  const isIdle = !isGameStarted;

  if (isIdle) {
    return null;
  }

  // Show opening card if: has selected opening and not complete
  // (show even when deviated to display alternatives)
  const showOpeningCard =
    openingTracker.selectedOpening &&
    !openingTracker.isOpeningComplete;

  return (
    <div className="tw-mt-3">
      <div className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-mb-2">Suggested moves</div>

      {/* Opening suggestion card - shown before engine suggestions */}
      {showOpeningCard && openingTracker.selectedOpening && (
        <OpeningSuggestionCard
          opening={openingTracker.selectedOpening}
          openingMoves={stableOpeningRef.current.openingMoves}
          nextMove={stableOpeningRef.current.nextMove}
          currentMoveIndex={stableOpeningRef.current.currentMoveIndex}
          isFollowing={openingTracker.isFollowingOpening}
          hasDeviated={openingTracker.hasDeviated}
          isShowingMoves={showingOpeningMoves}
          onToggleShowMoves={handleOpeningMovesToggle}
          onHoverShowMovesStart={handleOpeningMovesHoverStart}
          onHoverShowMovesEnd={handleOpeningMovesHoverEnd}
          alternatives={alternatives}
          isLoadingAlternatives={isLoadingAlternatives}
          onSelectAlternative={handleSelectAlternative}
          playerColor={playerColor}
          showingAlternativeIndex={showingAlternativeIndex}
          onToggleAlternativePreview={handleToggleAlternativePreview}
          onHoverAlternativeStart={handleHoverAlternativeStart}
          onHoverAlternativeEnd={handleHoverAlternativeEnd}
          openingColor={openingArrowColor}
        />
      )}

      {isLoading && suggestions.length === 0 ? (
        <div className="tw-flex tw-items-center tw-justify-center tw-py-3 tw-text-muted-foreground">
          <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin tw-mr-2" />
          <span className="tw-text-sm">Analyzing...</span>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="tw-text-center tw-py-3 tw-text-sm tw-text-muted-foreground">
          No suggestions yet
        </div>
      ) : (
        <div className="tw-space-y-1.5">
          {suggestionsWithFlags.map(({ suggestion, flags }, index) => {
            // Get arrow color based on index and settings
            const arrowColor = useSameColorForAllArrows
              ? singleArrowColor
              : index === 0
                ? firstArrowColor
                : index === 1
                  ? secondArrowColor
                  : thirdArrowColor;

            return (
              <SuggestionCard
                key={suggestion.move}
                suggestion={suggestion}
                rank={index + 1}
                isSelected={selectedIndex === index}
                isShowingPv={showingPvIndex === index}
                flags={flags}
                fen={suggestedFen || ''}
                playerColor={playerColor}
                arrowColor={arrowColor}
                onSelect={() => setSelectedIndex(index)}
                onHoverStart={() => setHoveredIndex(index)}
                onHoverEnd={() => setHoveredIndex(null)}
                onTogglePv={() => handlePvToggle(index)}
                onPvHoverStart={() => handlePvHoverStart(index)}
                onPvHoverEnd={handlePvHoverEnd}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
