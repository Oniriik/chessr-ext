import { Chess } from 'chess.js';
import type { Suggestion } from './uci.js';

export type MoveLabel = 'check' | 'mate' | 'capture' | 'promotion';

export interface LabeledSuggestion extends Suggestion {
  labels: MoveLabel[];
}

export function labelSuggestions(suggestions: Suggestion[], fen: string): LabeledSuggestion[] {
  if (!suggestions.length) return [];

  // `mateScore` upstream is normalized to white's POV: positive = white wins,
  // negative = black wins. So "the side to move is delivering mate" depends on
  // whose turn it is.
  const isWhiteToMove = fen.split(' ')[1] === 'w';

  return suggestions.map((s) => {
    try {
      const chess = new Chess(fen);
      const result = chess.move({ from: s.move.slice(0, 2), to: s.move.slice(2, 4), promotion: s.move[4] || undefined });

      if (!result) return { ...s, labels: [] };

      // Mate delivered by this very move (mate-in-1).
      if (chess.isCheckmate()) return { ...s, labels: ['mate'] };

      // Mate-in-N where the side to move wins — label as mate too.
      const playerMates = s.mateScore !== null && (
        (isWhiteToMove && s.mateScore > 0) ||
        (!isWhiteToMove && s.mateScore < 0)
      );
      if (playerMates) return { ...s, labels: ['mate'] };

      // Order: capture, promotion, check
      const labels: MoveLabel[] = [];
      if (result.captured) labels.push('capture');
      if (result.promotion) labels.push(`promotion:${result.promotion}` as MoveLabel);
      if (chess.isCheck()) labels.push('check');

      return { ...s, labels };
    } catch (e) {
      console.error(`[Label] Failed to label ${s.move}:`, e);
    }

    return { ...s, labels: [] };
  });
}
