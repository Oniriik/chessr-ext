/**
 * Feedback Store (Zustand)
 * Manages state for the dual-phase analysis feedback system
 */

import { create } from 'zustand';
import {
  ChessrState,
  ChessrStatus,
  SuggestionResult,
  SuggestionError,
  AnalysisNewResult,
  AnalysisNewError,
  NewAccuracyCache,
  MoveAnalysis,
  Side,
} from '../../domain/analysis/feedback-types';
import { onPlayerMoveDetected } from '../../domain/analysis/feedback-helpers';

interface FeedbackStore extends ChessrState {
  // Actions
  handlePlayerMove: (playedMoveUci: string) => void;

  setStatus: (status: ChessrStatus) => void;

  setSelectedSuggestionIndex: (index: number) => void;

  clearFeedback: () => void;

  reset: () => void;

  // Accuracy state
  newAccuracyCache: NewAccuracyCache | null;

  handleNewSuggestionResult: (
    result: SuggestionResult,
    currentFen: string,
    currentMovesUci: string[]
  ) => void;

  handleNewSuggestionError: (error: SuggestionError) => void;

  handleNewAnalysisResult: (result: AnalysisNewResult) => void;

  handleNewAnalysisError: (error: AnalysisNewError) => void;

  resetNewAccuracy: () => void;
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

  // ============================================================================
  // NEW ARCHITECTURE HANDLERS
  // ============================================================================

  newAccuracyCache: null,

  handleNewSuggestionResult: (result, currentFen, currentMovesUci) => {
    const plyIndex = currentMovesUci.length;
    const sideToMove = currentFen.split(' ')[1] as Side;
    const fenHash = currentFen.substring(0, 30);

    // Build active snapshot from new suggestion result
    set({
      status: 'SHOWING',
      activeSnapshot: {
        requestId: result.requestId,
        fenHash,
        plyIndex,
        sideToMove,
        chosenIndex: 0, // First suggestion is always the recommended one
        suggestions: result.suggestions,
        accuracy: get().activeSnapshot?.accuracy || {
          method: 'win_percent_loss',
          window: { lastMoves: 0, lastPlies: 0, analyzedPlies: 0, startPlyIndex: 0 },
          overall: 100,
          summary: {
            brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
            book: 0, inaccuracies: 0, mistakes: 0, blunders: 0,
          },
          perPly: [],
        },
        receivedAt: Date.now(),
      },
      selectedSuggestionIndex: 0,
    });

    console.log('[Feedback] New suggestion result processed', {
      status: 'SHOWING',
      plyIndex,
      suggestions: result.suggestions.length,
      positionEval: result.positionEval,
      mateIn: result.mateIn,
    });
  },

  handleNewSuggestionError: (error) => {
    console.error('[Feedback] Suggestion error', error.error);
    set({ status: 'IDLE' });
  },

  handleNewAnalysisResult: (result) => {
    // Deep copy the current cache to avoid mutation issues
    const currentCache = get().newAccuracyCache;
    const baseCache: NewAccuracyCache = currentCache ? {
      moveAnalyses: [...currentCache.moveAnalyses],
      accuracy: currentCache.accuracy,
      accuracyTrend: currentCache.accuracyTrend,
      phaseStats: {
        opening: { ...currentCache.phaseStats.opening },
        middlegame: { ...currentCache.phaseStats.middlegame },
        endgame: { ...currentCache.phaseStats.endgame },
      },
      summary: { ...currentCache.summary },
    } : {
      moveAnalyses: [],
      accuracy: 100,
      accuracyTrend: 'stable',
      phaseStats: {
        opening: { moves: 0, accuracy: null },
        middlegame: { moves: 0, accuracy: null },
        endgame: { moves: 0, accuracy: null },
      },
      summary: {
        brilliant: 0,
        great: 0,
        best: 0,
        excellent: 0,
        good: 0,
        book: 0,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
      },
    };

    // Add move analysis to cache
    const moveAnalysis: MoveAnalysis = {
      plyIndex: baseCache.moveAnalyses.length,
      move: result.move,
      classification: result.classification,
      cpl: result.cpl,
      accuracyImpact: result.accuracyImpact,
      weightedImpact: result.weightedImpact,
      phase: result.phase,
      bestMove: result.bestMove,
      evalBefore: result.evalBefore,
      evalAfter: result.evalAfter,
      mateInAfter: result.mateInAfter,
    };

    const newMoveAnalyses = [...baseCache.moveAnalyses, moveAnalysis];

    // Update summary based on classification
    const newSummary = { ...baseCache.summary };
    // Map classification to summary key (handle singular vs plural)
    const classificationToKey: Record<string, keyof typeof newSummary> = {
      'Brilliant': 'brilliant',
      'Great': 'great',
      'Best': 'best',
      'Excellent': 'excellent',
      'Good': 'good',
      'Book': 'book',
      'Inaccuracy': 'inaccuracies',
      'Mistake': 'mistakes',
      'Blunder': 'blunders',
    };
    const summaryKey = classificationToKey[result.classification];
    if (summaryKey) {
      newSummary[summaryKey]++;
    }

    // Update phase stats (deep copy each phase object)
    const newPhaseStats = {
      opening: { ...baseCache.phaseStats.opening },
      middlegame: { ...baseCache.phaseStats.middlegame },
      endgame: { ...baseCache.phaseStats.endgame },
    };
    newPhaseStats[result.phase].moves++;

    // Calculate phase accuracy (simple average of weighted impacts)
    const phaseAnalyses = newMoveAnalyses.filter(m => m.phase === result.phase);
    const phaseImpact = phaseAnalyses.reduce((sum, m) => sum + m.weightedImpact, 0);
    newPhaseStats[result.phase].accuracy = Math.max(0, Math.round((100 - phaseImpact / phaseAnalyses.length) * 10) / 10);

    // Calculate overall accuracy (average of weighted impacts)
    const overallTotalImpact = newMoveAnalyses.reduce((sum, m) => sum + m.weightedImpact, 0);
    const newAccuracy = Math.max(0, Math.min(100, 100 - overallTotalImpact / newMoveAnalyses.length));

    // Calculate trend
    const prevAccuracy = baseCache.accuracy;
    const accuracyDelta = newAccuracy - prevAccuracy;
    const accuracyTrend: 'up' | 'down' | 'stable' =
      accuracyDelta > 0.1 ? 'up' :
      accuracyDelta < -0.1 ? 'down' : 'stable';

    const updatedCache: NewAccuracyCache = {
      moveAnalyses: newMoveAnalyses,
      accuracy: Math.round(newAccuracy * 10) / 10,
      accuracyTrend,
      phaseStats: newPhaseStats,
      summary: newSummary,
    };

    set({ newAccuracyCache: updatedCache });

    console.log('[Feedback] New analysis result processed', {
      move: result.move,
      classification: result.classification,
      cpl: result.cpl,
      phase: result.phase,
      totalMoves: newMoveAnalyses.length,
      accuracy: updatedCache.accuracy,
      summary: newSummary,
    });
  },

  handleNewAnalysisError: (error) => {
    console.error('[Feedback] Analysis error', error.error);
  },

  resetNewAccuracy: () => {
    set({
      newAccuracyCache: {
        moveAnalyses: [],
        accuracy: 100,
        accuracyTrend: 'stable',
        phaseStats: {
          opening: { moves: 0, accuracy: null },
          middlegame: { moves: 0, accuracy: null },
          endgame: { moves: 0, accuracy: null },
        },
        summary: {
          brilliant: 0,
          great: 0,
          best: 0,
          excellent: 0,
          good: 0,
          book: 0,
          inaccuracies: 0,
          mistakes: 0,
          blunders: 0,
        },
      },
    });
  },
}));
