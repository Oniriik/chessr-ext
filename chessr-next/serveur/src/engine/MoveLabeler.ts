/**
 * MoveLabeler - Computes confidence scores for suggestions
 * Based on classical alpha-beta search metrics (evaluation, depth)
 */

import type { RawSuggestion } from './EngineManager.js';

export type ConfidenceLabel = 'very_reliable' | 'reliable' | 'playable' | 'risky' | 'speculative';

export interface LabeledSuggestion extends RawSuggestion {
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

/**
 * Map confidence score to label
 */
function getConfidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.85) return 'very_reliable';
  if (confidence >= 0.65) return 'reliable';
  if (confidence >= 0.45) return 'playable';
  if (confidence >= 0.25) return 'risky';
  return 'speculative';
}

/**
 * Compute confidence scores for suggestions
 * Formula: evalScore * 0.7 + depthScore * 0.3
 */
export function labelSuggestions(suggestions: RawSuggestion[]): LabeledSuggestion[] {
  if (!suggestions || suggestions.length === 0) {
    return [];
  }

  // Get best evaluation and max depth for normalization
  const bestEval = suggestions[0].evaluation;
  const maxDepth = Math.max(...suggestions.map(s => s.depth), 1);

  return suggestions.map(suggestion => {
    // Mate override - forced mate always has max confidence
    if (suggestion.mateScore !== null && suggestion.mateScore > 0) {
      return {
        ...suggestion,
        confidence: 1.0,
        confidenceLabel: 'very_reliable' as ConfidenceLabel,
      };
    }

    // Eval reliability (70% weight)
    // Lower eval difference from best = more reliable
    const evalDiff = Math.abs(bestEval - suggestion.evaluation);
    const evalScore = 1 - Math.min(evalDiff / 200, 1);

    // Depth confidence (30% weight)
    // Higher depth = more explored = more confident
    const depthScore = suggestion.depth / maxDepth;

    // Weighted composite
    const confidence = Math.max(0, Math.min(1, evalScore * 0.7 + depthScore * 0.3));

    // Round to 2 decimal places
    const roundedConfidence = Math.round(confidence * 100) / 100;

    return {
      ...suggestion,
      confidence: roundedConfidence,
      confidenceLabel: getConfidenceLabel(roundedConfidence),
    };
  });
}
