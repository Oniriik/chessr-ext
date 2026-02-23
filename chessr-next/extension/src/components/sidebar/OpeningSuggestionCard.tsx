/**
 * OpeningSuggestionCard - Displays the selected opening above engine suggestions
 * Shows the opening name, move list with progress, and next move to play
 * When deviated, shows compatible opening alternatives with preview
 */

import type { SavedOpening } from '../../stores/openingStore';
import type { OpeningWithStats } from '../../lib/openingsDatabase';
import { BookOpen, Eye, EyeOff, Loader2 } from 'lucide-react';

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
 * Compact move chips for displaying opening moves - matching Engine tab style
 */
function MoveChipsCompact({ moves }: { moves: string }) {
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
            className={`tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-mono ${
              isWhiteMove
                ? 'tw-bg-white/10 tw-text-white/80'
                : 'tw-bg-zinc-700/50 tw-text-zinc-400'
            }`}
          >
            {move}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Alternative opening row in the deviation section - matching Engine tab style
 */
function AlternativeOpeningRow({
  opening,
  playerColor,
  isShowingPreview,
  onSelect,
  onTogglePreview,
  onHoverPreviewStart,
  onHoverPreviewEnd,
  color,
}: {
  opening: OpeningWithStats;
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
      className="tw-p-2.5 tw-rounded-lg tw-bg-muted/30 hover:tw-bg-muted/50 tw-cursor-pointer tw-transition-all"
      style={{
        boxShadow: isShowingPreview ? `inset 0 0 0 1.5px ${hexToRgba(color, 0.5)}` : 'none',
      }}
      onClick={onSelect}
    >
      {/* Header: ECO + Name + WinRate + Eye */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-mb-2">
        <span className="tw-text-[10px] tw-font-mono tw-text-muted-foreground tw-flex-shrink-0">
          {opening.eco}
        </span>
        <span className="tw-text-sm tw-font-medium tw-truncate tw-flex-1">{opening.name}</span>
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-shrink-0">
          <span className="tw-text-xs tw-font-medium" style={{ color }}>
            {winRate.toFixed(0)}%
          </span>
          <button
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
            className={`tw-h-6 tw-w-6 tw-rounded-md tw-flex tw-items-center tw-justify-center tw-transition-colors ${
              isShowingPreview
                ? 'tw-bg-primary/20 tw-text-primary'
                : 'tw-text-muted-foreground hover:tw-bg-muted'
            }`}
            title={isShowingPreview ? 'Hide moves' : 'Show moves'}
          >
            {isShowingPreview ? <Eye className="tw-w-3.5 tw-h-3.5" /> : <EyeOff className="tw-w-3.5 tw-h-3.5" />}
          </button>
        </div>
      </div>

      {/* Winrate bar */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-mb-2">
        <div className="tw-flex tw-h-1.5 tw-rounded-full tw-overflow-hidden tw-bg-muted tw-flex-1">
          <div className="tw-bg-white" style={{ width: `${opening.whiteWinRate}%` }} />
          <div className="tw-bg-zinc-500" style={{ width: `${opening.drawRate}%` }} />
          <div className="tw-bg-zinc-800" style={{ width: `${opening.blackWinRate}%` }} />
        </div>
        <div className="tw-flex tw-gap-1.5 tw-text-[10px] tw-tabular-nums tw-flex-shrink-0">
          <span className="tw-text-white/70">{opening.whiteWinRate.toFixed(0)}</span>
          <span className="tw-text-zinc-500">{opening.drawRate.toFixed(0)}</span>
          <span className="tw-text-zinc-600">{opening.blackWinRate.toFixed(0)}</span>
        </div>
      </div>

      {/* Move chips */}
      <MoveChipsCompact moves={opening.moves} />
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
  const nextMoveIndex =
    nextMove && isFollowing
      ? openingMoves.findIndex((m, i) => i >= currentMoveIndex && m === nextMove)
      : null;

  // Get remaining moves after the next move
  const remainingMoves =
    nextMoveIndex !== null && nextMoveIndex >= 0 ? openingMoves.slice(nextMoveIndex + 1) : [];

  return (
    <div
      className="tw-p-2.5 tw-rounded-lg tw-transition-all tw-bg-muted/30 hover:tw-bg-muted/50"
      style={{
        boxShadow: hasDeviated
          ? 'inset 0 0 0 1.5px rgba(239, 68, 68, 0.4)'
          : isFollowing
            ? `inset 0 0 0 1.5px ${hexToRgba(openingColor, 0.4)}`
            : 'none',
      }}
    >
      {/* Header: Badge + Move + ECO | Eye */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-wrap tw-flex-1 tw-min-w-0">
          {/* Opening badge */}
          <span
            className="tw-inline-flex tw-items-center tw-gap-1 tw-w-5 tw-h-5 tw-rounded-md tw-justify-center tw-flex-shrink-0"
            style={{ backgroundColor: hexToRgba(openingColor, 0.2) }}
          >
            <BookOpen className="tw-w-3 tw-h-3" style={{ color: openingColor }} />
          </span>
          {/* Next move to play */}
          {nextMove && isFollowing && !hasDeviated && (
            <span className="tw-text-sm tw-font-semibold" style={{ color: openingColor }}>{nextMove}</span>
          )}
          {/* ECO code */}
          <span className="tw-text-[10px] tw-font-mono tw-text-muted-foreground">
            {opening.eco}
          </span>
          {/* Deviation badge */}
          {hasDeviated && (
            <span className="tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded-md tw-font-medium tw-bg-rose-500/15 tw-text-rose-400">
              Deviated
            </span>
          )}
        </div>
        {/* Eye button */}
        {!hasDeviated && (
          <button
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
            className={`tw-h-6 tw-w-6 tw-rounded-md tw-flex tw-items-center tw-justify-center tw-transition-colors tw-flex-shrink-0 ${
              isShowingMoves
                ? 'tw-bg-primary/20 tw-text-primary'
                : 'tw-bg-transparent tw-text-muted-foreground hover:tw-bg-muted'
            }`}
            title={isShowingMoves ? 'Hide moves' : 'Show moves'}
          >
            {isShowingMoves ? <Eye className="tw-w-3.5 tw-h-3.5" /> : <EyeOff className="tw-w-3.5 tw-h-3.5" />}
          </button>
        )}
      </div>

      {/* Remaining moves - using consistent chip style */}
      {remainingMoves.length > 0 && isFollowing && !hasDeviated && (
        <div className="tw-flex tw-items-center tw-gap-0.5 tw-mt-2 tw-flex-wrap">
          {remainingMoves.map((move, i) => {
            const actualIndex = nextMoveIndex !== null ? nextMoveIndex + 1 + i : i;
            const isWhiteMove = actualIndex % 2 === 0;
            return (
              <span
                key={i}
                className={`tw-text-[10px] tw-px-1.5 tw-py-0.5 tw-rounded tw-font-mono ${
                  isWhiteMove
                    ? 'tw-bg-white/10 tw-text-white/80'
                    : 'tw-bg-zinc-700/50 tw-text-zinc-400'
                }`}
              >
                {move}
              </span>
            );
          })}
        </div>
      )}

      {/* Opening name */}
      {!hasDeviated && (
        <div className="tw-mt-1.5 tw-text-[10px] tw-text-muted-foreground">{opening.name}</div>
      )}

      {/* Alternative openings section when deviated */}
      {hasDeviated && (
        <div className="tw-mt-3 tw-pt-2 tw-border-t tw-border-rose-500/20">
          <div className="tw-text-[10px] tw-font-medium tw-text-muted-foreground tw-uppercase tw-tracking-wide tw-mb-2">
            Alternative Openings
          </div>

          {isLoadingAlternatives ? (
            <div className="tw-flex tw-items-center tw-justify-center tw-py-4">
              <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin tw-text-muted-foreground" />
            </div>
          ) : alternatives.length === 0 ? (
            <div className="tw-text-center tw-py-3">
              <p className="tw-text-xs tw-text-muted-foreground">No alternatives found</p>
            </div>
          ) : (
            <div className="tw-space-y-1.5">
              {alternatives.map((alt, index) => (
                <AlternativeOpeningRow
                  key={`${alt.eco}-${alt.name}`}
                  opening={alt}
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
