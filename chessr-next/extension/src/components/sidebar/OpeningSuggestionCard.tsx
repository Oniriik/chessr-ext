/**
 * OpeningSuggestionCard - Displays the selected opening above engine suggestions
 * Shows the opening name, move list with progress, and next move to play
 * Styled like engine suggestion cards with purple theme
 */

import type { SavedOpening } from '../../stores/openingStore';
import { BookOpen, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/button';

interface OpeningSuggestionCardProps {
  opening: SavedOpening;
  openingMoves: string[];
  nextMove: string | null;
  currentMoveIndex: number;
  isFollowing: boolean;
  hasDeviated: boolean;
  isShowingMoves: boolean;
  onToggleShowMoves: () => void;
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
}: OpeningSuggestionCardProps) {
  // Find the index of the next player move in the opening sequence
  // nextMove is the next move the player should play (may be at currentMoveIndex or currentMoveIndex+1)
  const nextMoveIndex = nextMove && isFollowing
    ? openingMoves.findIndex((m, i) => i >= currentMoveIndex && m === nextMove)
    : null;

  // Get remaining moves after the next move (for "Next" section like engine cards)
  const remainingMoves = nextMoveIndex !== null && nextMoveIndex >= 0
    ? openingMoves.slice(nextMoveIndex + 1)
    : [];

  return (
    <div
      className={`tw-p-2 tw-rounded-md tw-border tw-mb-1.5 tw-transition-colors tw-bg-muted/50 ${
        hasDeviated
          ? 'tw-border-red-500/50'
          : isFollowing
            ? 'tw-border-purple-500/50'
            : 'tw-border-border'
      }`}
    >
      {/* Header with opening badge, name, eye button */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-wrap">
          {/* Opening badge instead of rank */}
          <span className="tw-inline-flex tw-items-center tw-gap-1 tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-medium tw-bg-purple-500/20 tw-text-purple-400">
            <BookOpen className="tw-w-3 tw-h-3" />
            Opening
          </span>
          {/* Next move in purple (like engine suggestion move) */}
          {nextMove && isFollowing && !hasDeviated && (
            <span className="tw-text-sm tw-font-medium tw-text-purple-400">{nextMove}</span>
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
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onToggleShowMoves();
            }}
            className={`tw-h-6 tw-w-6 ${isShowingMoves ? 'tw-text-purple-400 tw-bg-purple-500/20' : 'tw-text-muted-foreground'}`}
            title={isShowingMoves ? 'Hide opening moves on board' : 'Show opening moves on board'}
          >
            {isShowingMoves ? <Eye className="tw-w-3.5 tw-h-3.5" /> : <EyeOff className="tw-w-3.5 tw-h-3.5" />}
          </Button>
        </div>
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
                className="tw-inline-flex tw-items-center tw-gap-0.5 tw-text-[10px] tw-px-1 tw-py-0.5 tw-rounded tw-bg-purple-500/10 tw-text-purple-300 tw-font-mono"
              >
                <span className={`tw-w-1.5 tw-h-1.5 tw-rounded-full ${isWhiteMove ? 'tw-bg-white' : 'tw-bg-gray-600'}`} />
                {move}
              </span>
            );
          })}
        </div>
      )}

      {/* Opening name below */}
      <div className="tw-mt-1.5 tw-text-[10px] tw-text-muted-foreground">
        {opening.name}
      </div>
    </div>
  );
}
