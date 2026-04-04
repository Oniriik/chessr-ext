/**
 * AccuracyStore - Tracks move analysis and aggregates accuracy using CAPS2
 * Calibrated to match Chess.com's accuracy scoring
 */

import { create } from 'zustand';
import { logger } from '../lib/logger';

export type MoveClassification =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export type AccuracyTrend = 'up' | 'down' | 'stable';

export interface MoveAnalysis {
  moveNumber: number;
  move: string;
  classification: MoveClassification;
  caps2: number;           // CAPS2 score (-100 to 100)
  diff: number;            // Pawn difference
  wpDiff: number;          // Win probability % lost
  bestMove: string;
  evalBefore: number;      // Eval before move (pawns, player POV)
  evalAfter: number;       // Eval after move (pawns, player POV)
  mateInAfter?: number;
}

interface AccuracyState {
  // Per-move analysis
  moveAnalyses: MoveAnalysis[];

  // Aggregated accuracy (average CAPS2, 0-100)
  accuracy: number;

  // Trend tracking
  accuracyTrend: AccuracyTrend;

  // Request tracking
  currentRequestId: string | null;
  pendingMoveNumber: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  requestAnalysis: (moveNumber: number) => string;
  receiveAnalysis: (
    requestId: string,
    analysis: Omit<MoveAnalysis, 'moveNumber'>
  ) => void;
  receiveError: (requestId: string, error: string) => void;
  reset: () => void;

  // Getters
  getMoveCount: () => number;
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate accuracy as average CAPS2 score
 * Matches Chess.com's overall CAPS computation
 */
function calculateAccuracy(analyses: MoveAnalysis[]): number {
  if (analyses.length === 0) return 100;

  const totalCaps2 = analyses.reduce((sum, a) => sum + a.caps2, 0);
  const accuracy = totalCaps2 / analyses.length;

  return Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10));
}

export const useAccuracyStore = create<AccuracyState>()((set, get) => ({
  moveAnalyses: [],
  accuracy: 100,
  accuracyTrend: 'stable',
  currentRequestId: null,
  pendingMoveNumber: null,
  isLoading: false,
  error: null,

  requestAnalysis: (moveNumber) => {
    const requestId = generateRequestId();

    logger.log(`Requesting analysis for move ${moveNumber}`);

    set({
      currentRequestId: requestId,
      pendingMoveNumber: moveNumber,
      isLoading: true,
      error: null,
    });

    return requestId;
  },

  receiveAnalysis: (requestId, analysis) => {
    const { currentRequestId, pendingMoveNumber, moveAnalyses, accuracy: previousAccuracy } = get();

    if (requestId !== currentRequestId) {
      logger.log(`Ignoring stale analysis response: ${requestId}`);
      return;
    }

    if (pendingMoveNumber === null) return;

    const fullAnalysis: MoveAnalysis = {
      ...analysis,
      moveNumber: pendingMoveNumber,
    };

    // Add to analyses (maintain order by move number)
    const newAnalyses = [...moveAnalyses, fullAnalysis].sort(
      (a, b) => a.moveNumber - b.moveNumber
    );

    const newAccuracy = calculateAccuracy(newAnalyses);

    // Calculate accuracy change
    const accuracyDelta = Math.round((newAccuracy - previousAccuracy) * 10) / 10;
    const accuracyTrend: 'up' | 'down' | 'stable' =
      accuracyDelta > 0.1 ? 'up' : accuracyDelta < -0.1 ? 'down' : 'stable';

    // Log full analysis summary
    console.log('[Move Analysis Summary]', {
      move: fullAnalysis.move,
      moveNumber: fullAnalysis.moveNumber,
      classification: fullAnalysis.classification,
      caps2: fullAnalysis.caps2,
      diff: fullAnalysis.diff,
      wpDiff: fullAnalysis.wpDiff,
      bestMove: fullAnalysis.bestMove,
      // Aggregated stats
      totalMoves: newAnalyses.length,
      accuracy: newAccuracy,
      accuracyDelta,
      accuracyTrend,
    });

    set({
      moveAnalyses: newAnalyses,
      accuracy: newAccuracy,
      accuracyTrend,
      isLoading: false,
      currentRequestId: null,
      pendingMoveNumber: null,
    });
  },

  receiveError: (requestId, error) => {
    const { currentRequestId } = get();

    if (requestId !== currentRequestId) return;

    logger.error(`Analysis error: ${error}`);

    set({
      isLoading: false,
      error,
      currentRequestId: null,
      pendingMoveNumber: null,
    });
  },

  reset: () => {
    set({
      moveAnalyses: [],
      accuracy: 100,
      accuracyTrend: 'stable',
      currentRequestId: null,
      pendingMoveNumber: null,
      isLoading: false,
      error: null,
    });
  },

  getMoveCount: () => {
    return get().moveAnalyses.length;
  },
}));

// Convenience selectors
export const useAccuracy = () => useAccuracyStore((state) => state.accuracy);
export const useAccuracyTrend = () =>
  useAccuracyStore((state) => state.accuracyTrend);
export const useMoveAnalyses = () =>
  useAccuracyStore((state) => state.moveAnalyses);
export const useIsAnalyzing = () =>
  useAccuracyStore((state) => state.isLoading);
export const useAnalysisError = () =>
  useAccuracyStore((state) => state.error);

// Helper to compute classification counts (use with useMemo in components)
export function computeClassificationCounts(
  analyses: MoveAnalysis[]
): Record<MoveClassification, number> {
  const counts: Record<MoveClassification, number> = {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  analyses.forEach((a) => {
    counts[a.classification]++;
  });
  return counts;
}
