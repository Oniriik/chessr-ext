/**
 * Map torch's `classificationName` JSON values to chessr's
 * MoveClassification union. Torch uses camelCase ("greatFind"); we
 * normalise to chessr's flat names. Unknown values fall back to
 * 'good' (neutral) rather than throwing — torch may add new classes.
 */
import type { MoveClassification } from './moveAnalysis.js';
export type { MoveClassification };

const TORCH_TO_CHESSR: Record<string, MoveClassification> = {
  best: 'best',
  brilliant: 'brilliant',
  greatFind: 'great',
  excellent: 'excellent',
  good: 'good',
  book: 'book',
  forced: 'forced',
  inaccuracy: 'inaccuracy',
  mistake: 'mistake',
  miss: 'miss',
  blunder: 'blunder',
};

export function mapTorchClassification(name: string | undefined | null): MoveClassification {
  if (!name) return 'good';
  return TORCH_TO_CHESSR[name] ?? 'good';
}
