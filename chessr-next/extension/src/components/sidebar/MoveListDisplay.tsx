import { useState, useMemo } from 'react';
import { Chess } from 'chess.js';
import { useSuggestions, useIsSuggestionLoading, useSuggestedFen, type Suggestion, type ConfidenceLabel } from '../../stores/suggestionStore';
import { useGameStore } from '../../stores/gameStore';
import { Loader2 } from 'lucide-react';

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

function formatEval(evaluation: number, mateScore?: number): string {
  if (mateScore !== undefined && mateScore !== null) {
    const prefix = mateScore > 0 ? '+' : '';
    return `${prefix}M${Math.abs(mateScore)}`;
  }
  // Regular eval in pawns
  if (Math.abs(evaluation) < 0.05) {
    return '0.0';
  }
  const sign = evaluation > 0 ? '+' : '';
  return `${sign}${evaluation.toFixed(1)}`;
}

function getEvalColorClass(evaluation: number, mateScore?: number): string {
  if (mateScore !== undefined && mateScore !== null) {
    return mateScore > 0 ? 'tw-text-green-400' : 'tw-text-red-400';
  }
  if (Math.abs(evaluation) < 0.05) return 'tw-text-gray-400';
  if (evaluation > 0) return 'tw-text-green-400';
  return 'tw-text-red-400';
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  rank: number;
  isSelected: boolean;
  flags: MoveFlags;
  fen: string;
  onSelect: () => void;
}

function SuggestionCard({ suggestion, rank, isSelected, flags, fen, onSelect }: SuggestionCardProps) {
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
      className={`tw-p-2 tw-rounded-md tw-border tw-cursor-pointer tw-transition-colors tw-bg-muted/50 ${
        isSelected
          ? 'tw-border-primary'
          : 'tw-border-border hover:tw-border-primary/50'
      }`}
      onClick={onSelect}
    >
      {/* Header with move, badges, and eval */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-wrap">
          <span className="tw-text-xs tw-px-1 tw-py-0.5 tw-rounded tw-font-medium tw-bg-muted tw-text-muted-foreground">
            {rank}
          </span>
          <span className="tw-text-sm tw-font-medium tw-text-primary">
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
        <span className={`tw-text-sm tw-font-mono tw-font-semibold tw-shrink-0 ${getEvalColorClass(suggestion.evaluation, suggestion.mateScore)}`}>
          {formatEval(suggestion.evaluation, suggestion.mateScore)}
        </span>
      </div>

      {/* PV Line */}
      {pvSan.length > 1 && (
        <div className="tw-flex tw-items-center tw-gap-1 tw-mt-1.5 tw-flex-wrap">
          <span className="tw-text-[10px] tw-text-muted-foreground tw-uppercase tw-tracking-wide">
            Line
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
  const { isGameStarted } = useGameStore();
  const suggestions = useSuggestions();
  const suggestedFen = useSuggestedFen();
  const isLoading = useIsSuggestionLoading();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

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

  return (
    <div className="tw-mt-3">
      <div className="tw-text-xs tw-font-medium tw-text-muted-foreground tw-mb-2">Suggested moves</div>
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
          {suggestionsWithFlags.map(({ suggestion, flags }, index) => (
            <SuggestionCard
              key={suggestion.move}
              suggestion={suggestion}
              rank={index + 1}
              isSelected={selectedIndex === index}
              flags={flags}
              fen={suggestedFen || ''}
              onSelect={() => setSelectedIndex(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
