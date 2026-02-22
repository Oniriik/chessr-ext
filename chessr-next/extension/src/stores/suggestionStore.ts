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
  pv?: string[];  // Principal variation (UCI moves)
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

  // Selected suggestion index (0-based, for sidebar selection)
  selectedIndex: number;

  // Hovered suggestion index (0-based, null when not hovering)
  hoveredIndex: number | null;

  // Index of suggestion whose PV is being shown on board (null = none)
  showingPvIndex: number | null;

  // Whether opening moves are being shown on board
  showingOpeningMoves: boolean;

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
  setSelectedIndex: (index: number) => void;
  setHoveredIndex: (index: number | null) => void;
  toggleShowingPv: (index: number) => void;
  setShowingPvIndex: (index: number | null) => void;
  toggleShowingOpeningMoves: () => void;
  setShowingOpeningMoves: (showing: boolean) => void;

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
  selectedIndex: 0,
  hoveredIndex: null,
  showingPvIndex: null,
  showingOpeningMoves: false,

  /**
   * Request new suggestions - returns the requestId
   */
  requestSuggestions: (_fen, _targetElo, _personality, _multiPv) => {
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
      selectedIndex: 0, // Reset to first suggestion
      hoveredIndex: null,
      showingPvIndex: null,
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
      selectedIndex: 0,
      hoveredIndex: null,
      showingPvIndex: null,
      showingOpeningMoves: false,
    });
  },

  /**
   * Set the selected suggestion index
   */
  setSelectedIndex: (index) => {
    set({ selectedIndex: index });
  },

  /**
   * Set the hovered suggestion index
   */
  setHoveredIndex: (index) => {
    set({ hoveredIndex: index });
  },

  /**
   * Toggle showing PV for a suggestion
   */
  toggleShowingPv: (index) => {
    const { showingPvIndex } = get();
    set({ showingPvIndex: showingPvIndex === index ? null : index });
  },

  /**
   * Set the showing PV index directly (for hover preview)
   */
  setShowingPvIndex: (index) => {
    set({ showingPvIndex: index });
  },

  /**
   * Toggle showing opening moves on board
   */
  toggleShowingOpeningMoves: () => {
    const { showingOpeningMoves } = get();
    set({ showingOpeningMoves: !showingOpeningMoves });
  },

  /**
   * Set showing opening moves directly
   */
  setShowingOpeningMoves: (showing) => {
    set({ showingOpeningMoves: showing });
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
export const useSelectedSuggestionIndex = () =>
  useSuggestionStore((state) => state.selectedIndex);
export const useSetSelectedSuggestionIndex = () =>
  useSuggestionStore((state) => state.setSelectedIndex);
export const useHoveredSuggestionIndex = () =>
  useSuggestionStore((state) => state.hoveredIndex);
export const useSetHoveredSuggestionIndex = () =>
  useSuggestionStore((state) => state.setHoveredIndex);
export const useShowingPvIndex = () =>
  useSuggestionStore((state) => state.showingPvIndex);
export const useToggleShowingPv = () =>
  useSuggestionStore((state) => state.toggleShowingPv);
export const useSetShowingPvIndex = () =>
  useSuggestionStore((state) => state.setShowingPvIndex);
export const useShowingOpeningMoves = () =>
  useSuggestionStore((state) => state.showingOpeningMoves);
export const useToggleShowingOpeningMoves = () =>
  useSuggestionStore((state) => state.toggleShowingOpeningMoves);
export const useSetShowingOpeningMoves = () =>
  useSuggestionStore((state) => state.setShowingOpeningMoves);
