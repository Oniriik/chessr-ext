/**
 * OpeningSuggestionCard - Displays the selected opening above engine suggestions
 * Shows the opening name, move list with progress, and next move to play
 * When deviated, shows compatible opening alternatives with preview
 */

import type { SavedOpening } from '../../stores/openingStore';
import type { OpeningWithStats } from '../../lib/openingsDatabase';
import { BookOpen, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';

/**
 * Convert hex color to rgba
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface OpeningSuggestionCardProps {
  opening: SavedOpening;
  openingMoves: string[];
  nextMove: string | null;
  currentMoveIndex: number;
  isFollowing: boolean;
  hasDeviated: boolean;
  isShowingMoves: boolean;
  onToggleShowMoves: () => void;
  onHoverShowMovesStart?: () => void;
  onHoverShowMovesEnd?: () => void;
  // Alternative openings when deviated
  alternatives?: OpeningWithStats[];
  isLoadingAlternatives?: boolean;
  onSelectAlternative?: (opening: OpeningWithStats) => void;
  playerColor?: 'white' | 'black' | null;
  // Alternative preview
  showingAlternativeIndex?: number | null;
  onToggleAlternativePreview?: (index: number) => void;
  onHoverAlternativeStart?: (index: number) => void;
  onHoverAlternativeEnd?: () => void;
  // Opening color
  openingColor?: string;
}

/**
 * Compact move chips for displaying opening moves
 */
function MoveChipsCompact({ moves, color }: { moves: string; color: string }) {
  const moveList = moves
    .replace(/\d+\.\s*/g, '')
    .split(/\s+/)
    .filter((m) => m.length > 0);

  return (
    <div className="tw-flex tw-items-center tw-gap-0.5 tw-flex-wrap tw-mt-1">
      {moveList.map((move, i) => {
        const isWhiteMove = i % 2 === 0;
        return (
          <span
            key={i}
            className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-[9px] tw-px-0.5 tw-rounded tw-font-mono"
            style={{ backgroundColor: hexToRgba(color, 0.1), color: hexToRgba(color, 0.7) }}
          >
            <span
              className={`tw-w-1 tw-h-1 tw-rounded-full ${isWhiteMove ? 'tw-bg-white' : 'tw-bg-gray-600'}`}
            />
            {move}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Alternative opening row in the deviation section
 */
function AlternativeOpeningRow({
  opening,
  rank,
  playerColor,
  isShowingPreview,
  onSelect,
  onTogglePreview,
  onHoverPreviewStart,
  onHoverPreviewEnd,
  color,
}: {
  opening: OpeningWithStats;
  rank: number;
  playerColor: 'white' | 'black' | null;
  isShowingPreview: boolean;
  onSelect: () => void;
  onTogglePreview: () => void;
  onHoverPreviewStart: () => void;
  onHoverPreviewEnd: () => void;
  color: string;
}) {
  const winRate = playerColor === 'white' ? opening.whiteWinRate : opening.blackWinRate;

  return (
    <div
      className="tw-p-1.5 tw-rounded tw-bg-muted/30 hover:tw-bg-muted/50 tw-cursor-pointer tw-transition-colors tw-border"
      style={{
        borderColor: isShowingPreview ? hexToRgba(color, 0.5) : 'transparent',
      }}
      onClick={onSelect}
    >
      {/* Rank + ECO + Name + Eye + WinRate */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-min-w-0">
          {/* Rank badge */}
          <span
            className="tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-medium tw-whitespace-nowrap"
            style={{ backgroundColor: hexToRgba(color, 0.2), color }}
          >
            Alt {rank}
          </span>
          <span className="tw-font-mono tw-text-[10px] tw-px-1 tw-py-0 tw-rounded tw-bg-muted">
            {opening.eco}
          </span>
          <span className="tw-text-xs tw-truncate">{opening.name}</span>
        </div>
        <div className="tw-flex tw-items-center tw-gap-1 tw-shrink-0">
          {/* WinRate then Eye button */}
          <span className="tw-text-[10px] tw-font-medium" style={{ color }}>
            {winRate.toFixed(0)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePreview();
            }}
            onMouseEnter={(e) => {
              e.stopPropagation();
              onHoverPreviewStart();
            }}
            onMouseLeave={(e) => {
              e.stopPropagation();
              onHoverPreviewEnd();
            }}
            className={`tw-h-5 tw-w-5 ${isShowingPreview ? '' : 'tw-text-muted-foreground'}`}
            style={isShowingPreview ? { color, backgroundColor: hexToRgba(color, 0.2) } : undefined}
            title={isShowingPreview ? 'Hide moves on board' : 'Show moves on board'}
          >
            {isShowingPreview ? (
              <Eye className="tw-w-3 tw-h-3" />
            ) : (
              <EyeOff className="tw-w-3 tw-h-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Winrate bar compact */}
      <div className="tw-flex tw-h-1 tw-rounded-full tw-overflow-hidden tw-bg-muted tw-mt-1">
        <div className="tw-bg-white" style={{ width: `${opening.whiteWinRate}%` }} />
        <div className="tw-bg-zinc-400" style={{ width: `${opening.drawRate}%` }} />
        <div className="tw-bg-zinc-800" style={{ width: `${opening.blackWinRate}%` }} />
      </div>

      {/* Move chips */}
      <MoveChipsCompact moves={opening.moves} color={color} />
    </div>
  );
}

export function OpeningSuggestionCard({
  opening,
  openingMoves,
  nextMove,
  currentMoveIndex,
  isFollowing,
  hasDeviated,
  isShowingMoves,
  onToggleShowMoves,
  onHoverShowMovesStart,
  onHoverShowMovesEnd,
  alternatives = [],
  isLoadingAlternatives = false,
  onSelectAlternative,
  playerColor,
  showingAlternativeIndex,
  onToggleAlternativePreview,
  onHoverAlternativeStart,
  onHoverAlternativeEnd,
  openingColor = '#a855f7',
}: OpeningSuggestionCardProps) {
  // Find the index of the next player move in the opening sequence
  // nextMove is the next move the player should play (may be at currentMoveIndex or currentMoveIndex+1)
  const nextMoveIndex =
    nextMove && isFollowing
      ? openingMoves.findIndex((m, i) => i >= currentMoveIndex && m === nextMove)
      : null;

  // Get remaining moves after the next move (for "Next" section like engine cards)
  const remainingMoves =
    nextMoveIndex !== null && nextMoveIndex >= 0 ? openingMoves.slice(nextMoveIndex + 1) : [];

  // Compute border color based on state
  const borderColor = hasDeviated
    ? 'rgba(239, 68, 68, 0.5)' // red-500/50
    : isFollowing
      ? hexToRgba(openingColor, 0.5)
      : undefined;

  return (
    <div
      className="tw-p-2 tw-rounded-md tw-border tw-mb-1.5 tw-transition-colors tw-bg-muted/50 tw-border-border"
      style={borderColor ? { borderColor } : undefined}
    >
      {/* Header with opening badge, name, eye button */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-wrap">
          {/* Opening badge instead of rank */}
          <span
            className="tw-inline-flex tw-items-center tw-gap-1 tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-medium"
            style={{ backgroundColor: hexToRgba(openingColor, 0.2), color: openingColor }}
          >
            <BookOpen className="tw-w-3 tw-h-3" />
            Opening
          </span>
          {/* Next move (like engine suggestion move) */}
          {nextMove && isFollowing && !hasDeviated && (
            <span className="tw-text-sm tw-font-medium" style={{ color: openingColor }}>{nextMove}</span>
          )}
          {/* ECO code */}
          <span className="tw-text-[10px] tw-px-1 tw-py-0.5 tw-rounded tw-font-mono tw-bg-muted tw-text-muted-foreground">
            {opening.eco}
          </span>
          {/* Deviation badge */}
          {hasDeviated && (
            <span className="tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-medium tw-bg-red-500/20 tw-text-red-400">
              Deviated
            </span>
          )}
        </div>
        {/* Eye button to show moves on board */}
        {!hasDeviated && (
          <div className="tw-flex tw-items-center tw-gap-1.5 tw-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onToggleShowMoves();
              }}
              onMouseEnter={(e) => {
                e.stopPropagation();
                onHoverShowMovesStart?.();
              }}
              onMouseLeave={(e) => {
                e.stopPropagation();
                onHoverShowMovesEnd?.();
              }}
              className={`tw-h-6 tw-w-6 ${isShowingMoves ? '' : 'tw-text-muted-foreground'}`}
              style={isShowingMoves ? { color: openingColor, backgroundColor: hexToRgba(openingColor, 0.2) } : undefined}
              title={isShowingMoves ? 'Hide opening moves on board' : 'Show opening moves on board'}
            >
              {isShowingMoves ? (
                <Eye className="tw-w-3.5 tw-h-3.5" />
              ) : (
                <EyeOff className="tw-w-3.5 tw-h-3.5" />
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Next moves sequence (like engine PV line) */}
      {remainingMoves.length > 0 && isFollowing && !hasDeviated && (
        <div className="tw-flex tw-items-center tw-gap-1 tw-mt-1.5 tw-flex-wrap">
          <span className="tw-text-[10px] tw-text-muted-foreground tw-uppercase tw-tracking-wide">
            Next
          </span>
          {remainingMoves.map((move, i) => {
            // Determine if this is a white or black move based on position
            const actualIndex = nextMoveIndex !== null ? nextMoveIndex + 1 + i : i;
            const isWhiteMove = actualIndex % 2 === 0;
            return (
              <span
                key={i}
                className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-[10px] tw-px-1 tw-py-0.5 tw-rounded tw-font-mono"
                style={{ backgroundColor: hexToRgba(openingColor, 0.1), color: hexToRgba(openingColor, 0.7) }}
              >
                <span
                  className={`tw-w-1.5 tw-h-1.5 tw-rounded-full ${isWhiteMove ? 'tw-bg-white' : 'tw-bg-gray-600'}`}
                />
                {move}
              </span>
            );
          })}
        </div>
      )}

      {/* Opening name below */}
      {!hasDeviated && (
        <div className="tw-mt-1.5 tw-text-[10px] tw-text-muted-foreground">{opening.name}</div>
      )}

      {/* Alternative openings section when deviated */}
      {hasDeviated && (
        <div className="tw-mt-2 tw-pt-2 tw-border-t tw-border-red-500/20">
          <div className="tw-text-[10px] tw-text-muted-foreground tw-uppercase tw-tracking-wide tw-mb-1.5">
            Compatible Openings
          </div>

          {isLoadingAlternatives ? (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-muted-foreground">
              <Loader2 className="tw-w-3 tw-h-3 tw-animate-spin" />
              Finding alternatives...
            </div>
          ) : alternatives.length === 0 ? (
            <div className="tw-text-xs tw-text-muted-foreground tw-italic">
              No compatible openings found
            </div>
          ) : (
            <div className="tw-space-y-1.5">
              {alternatives.map((alt, index) => (
                <AlternativeOpeningRow
                  key={`${alt.eco}-${alt.name}`}
                  opening={alt}
                  rank={index + 1}
                  playerColor={playerColor ?? null}
                  isShowingPreview={showingAlternativeIndex === index}
                  onSelect={() => onSelectAlternative?.(alt)}
                  onTogglePreview={() => onToggleAlternativePreview?.(index)}
                  onHoverPreviewStart={() => onHoverAlternativeStart?.(index)}
                  onHoverPreviewEnd={() => onHoverAlternativeEnd?.()}
                  color={openingColor}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
