/**
 * AccuracyStore - Tracks move analysis and aggregates accuracy
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

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export type AccuracyTrend = 'up' | 'down' | 'stable';

export interface PhaseStats {
  moves: number;
  accuracy: number | null;
}

export interface MoveAnalysis {
  moveNumber: number;
  move: string;
  classification: MoveClassification;
  cpl: number;
  accuracyImpact: number;
  weightedImpact: number;
  phase: GamePhase;
  bestMove: string;
  evalAfter: number;      // Position eval after move (in pawns, white POV)
  mateInAfter?: number;   // Mate in X (positive = white mates, negative = black)
}

interface AccuracyState {
  // Per-move analysis
  moveAnalyses: MoveAnalysis[];

  // Aggregated accuracy (0-100)
  accuracy: number;

  // Trend tracking
  accuracyTrend: AccuracyTrend;
  phaseStats: Record<GamePhase, PhaseStats>;

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
  getTotalImpact: () => number;
  getMoveCount: () => number;
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate accuracy from total weighted impact
 * Formula: accuracy = 100 - (totalWeightedImpact / moveCount)
 */
function calculateAccuracy(analyses: MoveAnalysis[]): number {
  if (analyses.length === 0) return 100;

  const totalImpact = analyses.reduce((sum, a) => sum + a.weightedImpact, 0);
  const accuracy = 100 - totalImpact / analyses.length;

  return Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10));
}

const initialPhaseStats: Record<GamePhase, PhaseStats> = {
  opening: { moves: 0, accuracy: null },
  middlegame: { moves: 0, accuracy: null },
  endgame: { moves: 0, accuracy: null },
};

export const useAccuracyStore = create<AccuracyState>()((set, get) => ({
  moveAnalyses: [],
  accuracy: 100,
  accuracyTrend: 'stable',
  phaseStats: initialPhaseStats,
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
    const totalImpact = newAnalyses.reduce((sum, a) => sum + a.weightedImpact, 0);

    // Calculate accuracy change
    const accuracyDelta = Math.round((newAccuracy - previousAccuracy) * 10) / 10;
    const accuracyTrend: 'up' | 'down' | 'stable' =
      accuracyDelta > 0.1 ? 'up' : accuracyDelta < -0.1 ? 'down' : 'stable';

    // Calculate accuracy per phase
    const newPhaseStats = (['opening', 'middlegame', 'endgame'] as const).reduce(
      (acc, phase) => {
        const phaseMoves = newAnalyses.filter((a) => a.phase === phase);
        acc[phase] = {
          moves: phaseMoves.length,
          accuracy: phaseMoves.length > 0 ? calculateAccuracy(phaseMoves) : null,
        };
        return acc;
      },
      {} as Record<GamePhase, PhaseStats>
    );

    // Log full analysis summary
    console.log('[Move Analysis Summary]', {
      move: fullAnalysis.move,
      moveNumber: fullAnalysis.moveNumber,
      classification: fullAnalysis.classification,
      cpl: fullAnalysis.cpl,
      accuracyImpact: fullAnalysis.accuracyImpact,
      weightedImpact: fullAnalysis.weightedImpact,
      phase: fullAnalysis.phase,
      bestMove: fullAnalysis.bestMove,
      // Aggregated stats
      totalMoves: newAnalyses.length,
      totalImpact,
      accuracy: newAccuracy,
      accuracyDelta,
      accuracyTrend,
      // Per-phase accuracy
      phaseAccuracy: newPhaseStats,
    });

    set({
      moveAnalyses: newAnalyses,
      accuracy: newAccuracy,
      accuracyTrend,
      phaseStats: newPhaseStats,
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
      phaseStats: initialPhaseStats,
      currentRequestId: null,
      pendingMoveNumber: null,
      isLoading: false,
      error: null,
    });
  },

  getTotalImpact: () => {
    return get().moveAnalyses.reduce((sum, a) => sum + a.weightedImpact, 0);
  },

  getMoveCount: () => {
    return get().moveAnalyses.length;
  },
}));

// Convenience selectors
export const useAccuracy = () => useAccuracyStore((state) => state.accuracy);
export const useAccuracyTrend = () =>
  useAccuracyStore((state) => state.accuracyTrend);
export const usePhaseStats = () =>
  useAccuracyStore((state) => state.phaseStats);
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
