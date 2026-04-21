import { Chess } from 'chess.js';

export interface Suggestion {
  multipv: number;
  move: string;
  evaluation: number;
  depth: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  mateScore: number | null;
  pv: string[];
}

export type MoveLabel = 'check' | 'mate' | 'capture' | `promotion:${'q' | 'r' | 'b' | 'n'}`;

export interface LabeledSuggestion extends Suggestion {
  labels: MoveLabel[];
}

export function labelSuggestions(suggestions: Suggestion[], fen: string): LabeledSuggestion[] {
  if (!suggestions.length) return [];
  const isWhiteToMove = fen.split(' ')[1] === 'w';

  return suggestions.map((s) => {
    try {
      const chess = new Chess(fen);
      const result = chess.move({
        from: s.move.slice(0, 2),
        to: s.move.slice(2, 4),
        promotion: s.move[4] || undefined,
      });
      if (!result) return { ...s, labels: [] };

      // Promotion label stacks with every other state — a promotion coup can
      // simultaneously be check, mate, or a capture, and the UI needs to
      // know the promoted piece so the right badge is rendered.
      const promo: MoveLabel | null = result.promotion
        ? (`promotion:${result.promotion}` as MoveLabel)
        : null;

      if (chess.isCheckmate()) {
        return { ...s, labels: promo ? ['mate', promo] : ['mate'] };
      }

      const playerMates = s.mateScore !== null && (
        (isWhiteToMove && s.mateScore > 0) ||
        (!isWhiteToMove && s.mateScore < 0)
      );
      if (playerMates) {
        return { ...s, labels: promo ? ['mate', promo] : ['mate'] };
      }

      const labels: MoveLabel[] = [];
      if (result.captured) labels.push('capture');
      if (promo) labels.push(promo);
      if (chess.isCheck()) labels.push('check');
      return { ...s, labels };
    } catch (e) {
      console.error(`[Label] Failed to label ${s.move}:`, e);
    }
    return { ...s, labels: [] };
  });
}
