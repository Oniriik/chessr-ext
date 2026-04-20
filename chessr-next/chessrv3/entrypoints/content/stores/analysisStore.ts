/**
 * analysisStore — Tracks per-move analysis and running accuracy (CAPS2).
 */

import { create } from 'zustand';
import type { MoveClassification } from '../lib/moveAnalysis';

export interface MoveAnalysis {
  moveNumber: number;
  classification: MoveClassification;
  caps2: number;
  diff: number;
  wpDiff: number;
  evalBefore: number;
  evalAfter: number;
  bestMove: string;
}

export type AccuracyTrend = 'up' | 'down' | 'stable';

interface AnalysisState {
  moveAnalyses: MoveAnalysis[];
  accuracy: number;
  accuracyTrend: AccuracyTrend;
  isAnalyzing: boolean;
  lastAnalysis: MoveAnalysis | null;

  addAnalysis: (analysis: MoveAnalysis) => void;
  setAnalyzing: (v: boolean) => void;
  reset: () => void;
}

function computeAccuracy(analyses: MoveAnalysis[]): number {
  if (analyses.length === 0) return 100;
  const total = analyses.reduce((sum, a) => sum + a.caps2, 0);
  return Math.max(0, Math.min(100, Math.round((total / analyses.length) * 10) / 10));
}

export const useAnalysisStore = create<AnalysisState>()((set, get) => ({
  moveAnalyses: [],
  accuracy: 100,
  accuracyTrend: 'stable',
  isAnalyzing: false,
  lastAnalysis: null,

  addAnalysis: (analysis) => {
    const prev = get();
    const newAnalyses = [...prev.moveAnalyses, analysis].sort(
      (a, b) => a.moveNumber - b.moveNumber,
    );
    const newAccuracy = computeAccuracy(newAnalyses);
    const delta = newAccuracy - prev.accuracy;
    const trend: AccuracyTrend =
      delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'stable';

    set({
      moveAnalyses: newAnalyses,
      accuracy: newAccuracy,
      accuracyTrend: trend,
      isAnalyzing: false,
      lastAnalysis: analysis,
    });
  },

  setAnalyzing: (v) => set({ isAnalyzing: v }),

  reset: () =>
    set({
      moveAnalyses: [],
      accuracy: 100,
      accuracyTrend: 'stable',
      isAnalyzing: false,
      lastAnalysis: null,
    }),
}));

export const useAccuracy = () => useAnalysisStore((s) => s.accuracy);
export const useAccuracyTrend = () => useAnalysisStore((s) => s.accuracyTrend);
export const useIsAnalyzing = () => useAnalysisStore((s) => s.isAnalyzing);
export const useLastAnalysis = () => useAnalysisStore((s) => s.lastAnalysis);
export const useMoveAnalyses = () => useAnalysisStore((s) => s.moveAnalyses);

export function computeClassificationCounts(
  analyses: MoveAnalysis[],
): Record<MoveClassification, number> {
  const counts: Record<MoveClassification, number> = {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  for (const a of analyses) {
    counts[a.classification]++;
  }
  return counts;
}
