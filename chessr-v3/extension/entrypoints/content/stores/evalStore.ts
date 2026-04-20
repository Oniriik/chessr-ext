/**
 * evalStore — Current position evaluation for the eval bar.
 * Always stored in white's perspective (positive = white advantage).
 */

import { create } from 'zustand';

interface EvalState {
  eval: number | null;       // pawns, white's perspective (null = no eval yet)
  mateIn: number | null;     // mate in N from white's perspective (positive = white mates)
  setEval: (evalPawns: number, mateIn?: number | null) => void;
  reset: () => void;
}

export const useEvalStore = create<EvalState>((set) => ({
  eval: null,
  mateIn: null,
  setEval: (evalPawns, mateIn = null) => set({ eval: evalPawns, mateIn }),
  reset: () => set({ eval: null, mateIn: null }),
}));
