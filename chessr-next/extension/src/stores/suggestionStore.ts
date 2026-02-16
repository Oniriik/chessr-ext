/**
 * SuggestionStore - Manages move suggestions and request tracking
 */

import { create } from 'zustand';
import { logger } from '../lib/logger';

export type ConfidenceLabel = 'very_reliable' | 'reliable' | 'playable' | 'risky' | 'speculative';

export interface Suggestion {
  move: string;
  evaluation: number;
  depth: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  mateScore?: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

interface SuggestionState {
  // Current suggestions
  suggestions: Suggestion[];

  // Position evaluation (in pawns, e.g., +0.32 or -1.5)
  positionEval: number | null;

  // Mate in N moves (null if not a mate position)
  mateIn: number | null;

  // Win rate percentage (0-100, from white's perspective)
  winRate: number | null;

  // Request tracking
  currentRequestId: string | null;
  isLoading: boolean;
  error: string | null;

  // The FEN for which we have suggestions
  suggestedFen: string | null;

  // Actions
  requestSuggestions: (
    fen: string,
    targetElo: number,
    personality: string,
    multiPv: number
  ) => string;
  receiveSuggestions: (
    requestId: string,
    fen: string,
    positionEval: number,
    mateIn: number | null,
    winRate: number,
    suggestions: Suggestion[]
  ) => void;
  receiveError: (requestId: string, error: string) => void;
  clearSuggestions: () => void;

  // Validation
  isValidResponse: (requestId: string) => boolean;
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const useSuggestionStore = create<SuggestionState>()((set, get) => ({
  suggestions: [],
  positionEval: null,
  mateIn: null,
  winRate: null,
  currentRequestId: null,
  isLoading: false,
  error: null,
  suggestedFen: null,

  /**
   * Request new suggestions - returns the requestId
   */
  requestSuggestions: (fen, targetElo, personality, multiPv) => {
    const requestId = generateRequestId();

    logger.log(`Requesting suggestions, id=${requestId}`);

    set({
      currentRequestId: requestId,
      isLoading: true,
      error: null,
      // Don't clear suggestions yet - keep old ones until new arrive
    });

    return requestId;
  },

  /**
   * Receive suggestions from server
   */
  receiveSuggestions: (requestId, fen, positionEval, mateIn, winRate, suggestions) => {
    const { currentRequestId } = get();

    // Validate requestId
    if (requestId !== currentRequestId) {
      logger.log(
        `Ignoring stale suggestion response: ${requestId} (expected ${currentRequestId})`
      );
      return;
    }

    logger.log(`Received ${suggestions.length} suggestions for ${requestId}, eval: ${positionEval}, mate: ${mateIn}, winRate: ${winRate}`);

    set({
      suggestions,
      positionEval,
      mateIn,
      winRate,
      suggestedFen: fen,
      isLoading: false,
      error: null,
    });
  },

  /**
   * Receive error from server
   */
  receiveError: (requestId, error) => {
    const { currentRequestId } = get();

    if (requestId !== currentRequestId) {
      logger.log(`Ignoring stale error: ${requestId}`);
      return;
    }

    logger.error(`Suggestion error: ${error}`);

    set({
      isLoading: false,
      error,
    });
  },

  /**
   * Clear all suggestions
   */
  clearSuggestions: () => {
    set({
      suggestions: [],
      positionEval: null,
      mateIn: null,
      winRate: null,
      currentRequestId: null,
      isLoading: false,
      error: null,
      suggestedFen: null,
    });
  },

  /**
   * Check if a response is still valid
   */
  isValidResponse: (requestId) => {
    return requestId === get().currentRequestId;
  },
}));

// Convenience selectors
export const useSuggestions = () =>
  useSuggestionStore((state) => state.suggestions);
export const usePositionEval = () =>
  useSuggestionStore((state) => state.positionEval);
export const useMateIn = () =>
  useSuggestionStore((state) => state.mateIn);
export const useWinRate = () =>
  useSuggestionStore((state) => state.winRate);
export const useIsSuggestionLoading = () =>
  useSuggestionStore((state) => state.isLoading);
export const useSuggestionError = () =>
  useSuggestionStore((state) => state.error);
export const useSuggestedFen = () =>
  useSuggestionStore((state) => state.suggestedFen);
