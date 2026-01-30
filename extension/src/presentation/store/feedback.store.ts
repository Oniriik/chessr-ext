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
  mergeAccuracyIntoCache,
} from '../../domain/analysis/feedback-helpers';

interface FeedbackStore extends ChessrState {
  // Actions
  handleAnalyzeResult: (
    result: AnalyzeResultResponse,
    currentFen: string,
    currentMovesUci: string[]
  ) => void;

  handleStatsResult: (
    result: any, // AnalyzeStatsResponse
    currentFen: string,
    currentMovesUci: string[]
  ) => void;

  handleSuggestionsResult: (
    result: any, // AnalyzeSuggestionsResponse
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

  handleStatsResult: (result, currentFen, currentMovesUci) => {
    const currentState = get();

    // Extract accuracy data and merge into existing cache
    const accuracyPayload = result.payload.accuracy;

    // Merge new accuracy data into existing cache (accumulate instead of replace)
    const updatedCache = mergeAccuracyIntoCache(currentState.accuracyCache, accuracyPayload);

    // Update state with merged cache
    set({
      accuracyCache: updatedCache,
      previousAccuracy: currentState.activeSnapshot?.accuracy,
    });

    console.log('[Feedback] Stats result processed', {
      newPlies: accuracyPayload.perPly.length,
      totalCached: updatedCache.analyzedPlies.size,
      overall: accuracyPayload.overall,
      stats: updatedCache.overallStats,
    });
  },

  handleSuggestionsResult: (result, currentFen, currentMovesUci) => {
    const currentState = get();

    // Extract suggestions and cached accuracy
    const suggestionsPayload = result.payload.suggestions;
    const accuracyPayload = result.payload.accuracy; // Included for convenience

    // Build active snapshot
    const plyIndex = currentMovesUci.length;
    const sideToMove = currentFen.split(' ')[1] as 'w' | 'b';

    // Create fenHash (simple hash for now)
    const fenHash = currentFen.substring(0, 30);

    set({
      status: 'SHOWING',
      activeSnapshot: {
        requestId: result.requestId,
        fenHash,
        plyIndex,
        sideToMove,
        chosenIndex: suggestionsPayload.chosenIndex,
        suggestions: suggestionsPayload.suggestions,
        accuracy: accuracyPayload,
        receivedAt: Date.now(),
      },
      selectedSuggestionIndex: 0, // Default to first suggestion
    });

    console.log('[Feedback] Suggestions result processed', {
      status: 'SHOWING',
      plyIndex,
      suggestions: suggestionsPayload.suggestions.length,
      accuracy: accuracyPayload.overall,
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
