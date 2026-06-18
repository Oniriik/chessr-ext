/**
 * analysisStore — Tracks per-move analysis and running accuracy (CAPS2).
 */

import { create } from 'zustand';
import type { MoveClassification } from '../lib/moveAnalysis';
import { winProb, computeCAPS2 } from '../lib/moveAnalysis';
import type { CapsBlock, TallyMap, TorchAnalysis } from '../lib/torchJson';
import { useGameStore } from './gameStore';

export interface MoveAnalysis {
  moveNumber: number;
  /** Side that played this move. Lets the UI count and average per-side
   *  (chess.com's review card is per-side, not the combined ply list). */
  color: 'white' | 'black';
  classification: MoveClassification;
  caps2: number;
  diff: number;
  wpDiff: number;
  evalBefore: number;
  evalAfter: number;
  bestMove: string;
}

/** Slot for the per-side stats torch's fetch_analysis publishes. `null`
 *  means we're in degraded mode (server SF fallback) — UI hides the
 *  CAPS / Elo readouts in that case rather than showing zeros. */
export type TorchCaps = { white: CapsBlock | null; black: CapsBlock | null };
export type TorchEffectiveElo = { white: number | null; black: number | null };
export type TorchTallies = { white: TallyMap | null; black: TallyMap | null };

export type AccuracyTrend = 'up' | 'down' | 'stable';

interface AnalysisState {
  moveAnalyses: MoveAnalysis[];
  accuracy: number;
  accuracyTrend: AccuracyTrend;
  isAnalyzing: boolean;
  lastAnalysis: MoveAnalysis | null;

  // Torch-only slices. Null in degraded mode (server fallback active).
  caps: TorchCaps;
  effectiveElo: TorchEffectiveElo;
  tallies: TorchTallies;

  /** Opponent's last move — UCI + optional classification badge. Exposed
   *  so streamSync can propagate it to the stream-mode board. */
  currentOpponentMove: { uci: string; classification?: MoveClassification } | null;
  setCurrentOpponentMove: (v: { uci: string; classification?: MoveClassification } | null) => void;

  /** Player's last move — UCI + optional classification badge. Exposed
   *  so streamSync can propagate it to the stream-mode board. */
  currentMyLastMove: { uci: string; classification?: MoveClassification } | null;
  setCurrentMyLastMove: (v: { uci: string; classification?: MoveClassification } | null) => void;

  addAnalysis: (analysis: MoveAnalysis) => void;
  /** Bulk-replace state from a torch fetch_analysis result. Computes
   *  caps2/diff/wpDiff per move locally so existing accuracy reducers
   *  (which depend on these fields) continue to work numerically. */
  applyTorchAnalysis: (a: TorchAnalysis) => void;
  setAnalyzing: (v: boolean) => void;
  reset: () => void;
  /** Clear torch-only slices. Called on chessr:newGame alongside reset. */
  resetTorchSlices: () => void;
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
  caps: { white: null, black: null },
  effectiveElo: { white: null, black: null },
  tallies: { white: null, black: null },
  currentOpponentMove: null,
  setCurrentOpponentMove: (v) => set({ currentOpponentMove: v }),
  currentMyLastMove: null,
  setCurrentMyLastMove: (v) => set({ currentMyLastMove: v }),

  addAnalysis: (analysis) => {
    const prev = get();
    const newAnalyses = [...prev.moveAnalyses, analysis].sort(
      (a, b) => a.moveNumber - b.moveNumber,
    );
    // Keep torch's CAPS as accuracy when it's the most recent stat we have:
    // mixing torch-derived caps2 (rich path) with SF caps2 (UCI path) in
    // the same average produces nonsense (rich evals are clipped, so they
    // recompute to ~100 locally — pulling the displayed accuracy up).
    const playerColor = useGameStore.getState().playerColor;
    const torchPlayerCaps = playerColor ? prev.caps[playerColor]?.all : null;
    const newAccuracy = torchPlayerCaps != null
      ? prev.accuracy
      : computeAccuracy(newAnalyses);
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

  applyTorchAnalysis: (a) => {
    // Build full MoveAnalysis entries from torch's per-move evals so
    // existing reducers (computeAccuracy, computeClassificationCounts)
    // see populated caps2/diff/wpDiff. Eval BEFORE move i = -eval AFTER
    // move i-1 (POV swap); for move 0 we treat eval-before as 0.
    const augmented: MoveAnalysis[] = a.moveAnalyses.map((m, i) => {
      // Torch evaluations are always white-POV. Convert to "the player who
      // just moved"-POV for the local CAPS2 / classification math (which
      // expects positive = good for that player).
      const color: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
      const flip = color === 'white' ? 1 : -1;
      const evalAfterWhite = m.evaluation;
      const evalBeforeWhite = i === 0 ? 0 : a.moveAnalyses[i - 1].evaluation;
      const evalBefore = flip * evalBeforeWhite;
      const evalAfter = flip * evalAfterWhite;
      const diff = Math.max(0, evalBefore - evalAfter);
      const wpDiff = Math.max(0, winProb(evalBefore) - winProb(evalAfter));
      const caps2 = computeCAPS2(diff, Math.abs(evalBefore));
      return {
        moveNumber: Math.floor(i / 2) + 1,
        color,
        classification: m.classification,
        caps2: Math.round(caps2 * 10) / 10,
        diff: Math.round(diff * 100) / 100,
        wpDiff: Math.round(wpDiff * 100) / 100,
        evalBefore: Math.round(evalBefore * 100) / 100,
        evalAfter: Math.round(evalAfter * 100) / 100,
        bestMove: m.moveLan,
      };
    });
    // Prefer torch's CAPS for the player's side as the displayed accuracy.
    // Falling back to the local recomputation only when player color is
    // unknown or torch didn't provide a value (degraded reportCard).
    const playerColor = useGameStore.getState().playerColor;
    const torchPlayerCaps = playerColor ? a.caps[playerColor]?.all : null;
    const accuracy = torchPlayerCaps != null
      ? Math.round(torchPlayerCaps * 10) / 10
      : computeAccuracy(augmented);
    set({
      moveAnalyses: augmented,
      accuracy,
      // accuracyTrend not meaningful for bulk replace; keep stable.
      accuracyTrend: 'stable',
      lastAnalysis: augmented[augmented.length - 1] ?? null,
      isAnalyzing: false,
      caps: a.caps,
      effectiveElo: a.effectiveElo,
      tallies: a.tallies,
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
      currentOpponentMove: null,
      currentMyLastMove: null,
      caps: { white: null, black: null },
      effectiveElo: { white: null, black: null },
      tallies: { white: null, black: null },
    }),

  resetTorchSlices: () =>
    set({
      caps: { white: null, black: null },
      effectiveElo: { white: null, black: null },
      tallies: { white: null, black: null },
    }),
}));

export const useAccuracy = () => useAnalysisStore((s) => s.accuracy);
export const useAccuracyTrend = () => useAnalysisStore((s) => s.accuracyTrend);
export const useIsAnalyzing = () => useAnalysisStore((s) => s.isAnalyzing);
export const useLastAnalysis = () => useAnalysisStore((s) => s.lastAnalysis);
export const useMoveAnalyses = () => useAnalysisStore((s) => s.moveAnalyses);
export const useCaps = () => useAnalysisStore((s) => s.caps);
export const useEffectiveElo = () => useAnalysisStore((s) => s.effectiveElo);
export const useTallies = () => useAnalysisStore((s) => s.tallies);

export function computeClassificationCounts(
  analyses: MoveAnalysis[],
  color?: 'white' | 'black',
): Record<MoveClassification, number> {
  const counts: Record<MoveClassification, number> = {
    best: 0,
    brilliant: 0,
    great: 0,
    excellent: 0,
    good: 0,
    book: 0,
    forced: 0,
    inaccuracy: 0,
    mistake: 0,
    miss: 0,
    blunder: 0,
  };
  for (const a of analyses) {
    if (color && a.color !== color) continue;
    counts[a.classification]++;
  }
  return counts;
}
