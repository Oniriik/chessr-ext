/**
 * Feedback Store (Zustand)
 * Manages state for the dual-phase analysis feedback system
 */

import { create } from 'zustand';
import {
  ChessrState,
  ChessrStatus,
  Snapshot,
  MoveFeedback,
  AnalyzeResultResponse,
  AnalyzeErrorResponse,
} from '../../domain/analysis/feedback-types';
import {
  onAnalyzeResult,
  onPlayerMoveDetected,
} from '../../domain/analysis/feedback-helpers';

interface FeedbackStore extends ChessrState {
  // Actions
  handleAnalyzeResult: (
    result: AnalyzeResultResponse,
    currentFen: string,
    currentMovesUci: string[]
  ) => void;

  handlePlayerMove: (playedMoveUci: string) => void;

  handleAnalyzeError: (error: AnalyzeErrorResponse) => void;

  setStatus: (status: ChessrStatus) => void;

  setSelectedSuggestionIndex: (index: number) => void;

  clearFeedback: () => void;

  reset: () => void;
}

const initialState: ChessrState = {
  status: 'IDLE',
  activeSnapshot: undefined,
  lastFeedback: undefined,
  selectedSuggestionIndex: undefined,
  expandedPvSuggestionIndex: undefined,
  previousAccuracy: undefined,
  accuracyCache: undefined,
};

export const useFeedbackStore = create<FeedbackStore>((set, get) => ({
  ...initialState,

  handleAnalyzeResult: (result, currentFen, currentMovesUci) => {
    const currentState = get();
    const newState = onAnalyzeResult(
      currentState,
      result,
      currentFen,
      currentMovesUci
    );
    set(newState);

    console.log('[Feedback] Analyze result processed', {
      status: newState.status,
      plyIndex: newState.activeSnapshot?.plyIndex,
      suggestions: newState.activeSnapshot?.suggestions.length,
      accuracy: newState.activeSnapshot?.accuracy.overall,
    });
  },

  handlePlayerMove: (playedMoveUci) => {
    const currentState = get();
    const newState = onPlayerMoveDetected(currentState, playedMoveUci);
    set(newState);

    console.log('[Feedback] Player move processed', {
      move: playedMoveUci,
      wasSuggested: newState.lastFeedback?.wasSuggested,
      label: newState.lastFeedback?.label,
      deltaCp: newState.lastFeedback?.deltaCpVsBest,
    });
  },

  handleAnalyzeError: (error) => {
    console.error('[Feedback] Analyze error', error.error);
    set({ status: 'IDLE' });
  },

  setStatus: (status) => {
    set({ status });
  },

  setSelectedSuggestionIndex: (index) => {
    set({ selectedSuggestionIndex: index });
  },

  clearFeedback: () => {
    set({
      lastFeedback: undefined,
      expandedPvSuggestionIndex: undefined,
    });
  },

  reset: () => {
    set(initialState);
  },
}));
