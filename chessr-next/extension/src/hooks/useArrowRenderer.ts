/**
 * useArrowRenderer - Draws suggestion arrows on the chess board
 * Listens to suggestionStore and draws arrows when suggestions are available
 */

import { useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSuggestionStore, type Suggestion, type ConfidenceLabel } from '../stores/suggestionStore';
import { OverlayManager } from '../content/overlay/OverlayManager';
import { ArrowRenderer } from '../content/overlay/ArrowRenderer';
import { logger } from '../lib/logger';

// Confidence label to badge text
const CONFIDENCE_LABELS: Record<ConfidenceLabel, string> = {
  very_reliable: 'Best',
  reliable: 'Safe',
  playable: 'OK',
  risky: 'Risky',
  speculative: 'Risky',
};

// Piece symbols for capture badges
const PIECE_SYMBOLS: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

// Piece names for promotion
const PIECE_NAMES: Record<string, string> = {
  q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight',
};

/**
 * Build badges for a suggestion
 */
function buildBadges(suggestion: Suggestion, fen: string): string[] {
  const badges: string[] = [];

  // Quality badge
  badges.push(CONFIDENCE_LABELS[suggestion.confidenceLabel]);

  // Compute move flags using chess.js
  try {
    const chess = new Chess(fen);
    const from = suggestion.move.slice(0, 2);
    const to = suggestion.move.slice(2, 4);
    const promotion = suggestion.move.length === 5 ? suggestion.move[4] : undefined;

    const move = chess.move({ from, to, promotion });
    if (move) {
      // Mate badge
      if (suggestion.mateScore !== undefined && suggestion.mateScore !== null) {
        badges.push(`Mate ${Math.abs(suggestion.mateScore)}`);
      } else if (chess.isCheckmate()) {
        badges.push('Mate');
      } else if (chess.isCheck()) {
        badges.push('Check');
      }

      // Capture badge
      if (move.captured) {
        badges.push(`x ${PIECE_SYMBOLS[move.captured] || ''}`);
      }

      // Promotion badge
      if (move.promotion) {
        badges.push(`${PIECE_SYMBOLS[move.promotion] || '♛'} ${PIECE_NAMES[move.promotion] || 'Queen'}`);
      }
    }
  } catch {
    // Ignore errors
  }

  return badges;
}

/**
 * Convert UCI move (e.g., "e2e4") to from/to squares
 */
function parseUciMove(uciMove: string): { from: string; to: string } | null {
  if (uciMove.length < 4) return null;
  return {
    from: uciMove.slice(0, 2),
    to: uciMove.slice(2, 4),
  };
}

/**
 * Calculate arrow length (in squares) for sorting
 */
function getArrowLength(from: string, to: string): number {
  const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const rankDiff = Math.abs(parseInt(from[1]) - parseInt(to[1]));
  return Math.sqrt(fileDiff * fileDiff + rankDiff * rankDiff);
}

/**
 * Find the chess board element on Chess.com
 */
function findBoardElement(): HTMLElement | null {
  return document.querySelector('wc-chess-board, chess-board, .chessboard') as HTMLElement | null;
}

/**
 * Check if the board is flipped (black's perspective)
 */
function isBoardFlipped(): boolean {
  const board = findBoardElement();
  if (!board) return false;

  return (
    board.classList.contains('flipped') ||
    board.closest('.flipped') !== null ||
    board.getAttribute('flipped') === 'true'
  );
}

export function useArrowRenderer() {
  const { isGameStarted, playerColor, currentTurn, chessInstance } =
    useGameStore();
  const { suggestions, suggestedFen } = useSuggestionStore();
  const {
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
    showDetailedMoveSuggestion,
  } = useSettingsStore();

  const overlayRef = useRef<OverlayManager | null>(null);
  const rendererRef = useRef<ArrowRenderer | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize overlay when game starts
  useEffect(() => {
    if (!isGameStarted) {
      // Clean up when game ends
      if (overlayRef.current) {
        overlayRef.current.destroy();
        overlayRef.current = null;
        rendererRef.current = null;
        isInitializedRef.current = false;
      }
      return;
    }

    // Find board element
    const boardElement = findBoardElement();
    if (!boardElement) return;

    // Initialize overlay if not already done
    if (!isInitializedRef.current) {
      const overlay = new OverlayManager();
      const isFlipped = isBoardFlipped();
      overlay.initialize(boardElement, isFlipped);

      overlayRef.current = overlay;
      rendererRef.current = new ArrowRenderer(overlay);
      isInitializedRef.current = true;
    }

    // Update flipped state
    if (overlayRef.current) {
      overlayRef.current.setFlipped(playerColor === 'black');
    }

    return () => {
      // Cleanup on unmount
      if (overlayRef.current) {
        overlayRef.current.destroy();
        overlayRef.current = null;
        rendererRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, [isGameStarted, playerColor]);

  // Draw arrows when suggestions change
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Clear previous arrows
    renderer.clear();

    // Only show arrows on player's turn
    const isPlayerTurn = playerColor === currentTurn;
    if (!isPlayerTurn) return;

    // No suggestions to draw
    if (!suggestions || suggestions.length === 0) return;

    // Check if suggestions are for current position
    const currentFen = chessInstance?.fen();
    if (!currentFen || suggestedFen !== currentFen) {
      logger.log('Suggestions are stale, waiting for new ones');
      return;
    }

    // Get arrow colors based on settings
    const getArrowColor = (index: number): string => {
      if (useSameColorForAllArrows) {
        return singleArrowColor;
      }

      switch (index) {
        case 0:
          return firstArrowColor;
        case 1:
          return secondArrowColor;
        case 2:
          return thirdArrowColor;
        default:
          return firstArrowColor;
      }
    };

    // Draw arrows for each suggestion (up to numberOfSuggestions)
    const suggestionsToShow = suggestions.slice(0, numberOfSuggestions);
    logger.log(
      `Drawing ${suggestionsToShow.length} arrows (numberOfSuggestions: ${numberOfSuggestions}, total suggestions: ${suggestions.length})`
    );

    // Build arrow data with length for sorting
    const arrowData: { from: string; to: string; color: string; opacity: number; length: number; badges: string[]; rank: number }[] = [];

    suggestionsToShow.forEach((suggestion, index) => {
      const parsed = parseUciMove(suggestion.move);
      if (!parsed) return;

      // Build badges if setting is enabled
      const badges = showDetailedMoveSuggestion && currentFen
        ? buildBadges(suggestion, currentFen)
        : [];

      arrowData.push({
        from: parsed.from,
        to: parsed.to,
        color: getArrowColor(index),
        opacity: 0.85 - index * 0.15,
        length: getArrowLength(parsed.from, parsed.to),
        badges,
        rank: index + 1, // 1-based rank
      });
    });

    // Sort by length descending (longest first, so shortest appears on top)
    arrowData.sort((a, b) => b.length - a.length);

    // Draw arrows in sorted order
    for (const arrow of arrowData) {
      renderer.drawArrow({
        from: arrow.from,
        to: arrow.to,
        color: arrow.color,
        opacity: arrow.opacity,
        badges: arrow.badges,
        rank: arrow.rank,
      });
    }
  }, [
    suggestions,
    suggestedFen,
    chessInstance,
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
    showDetailedMoveSuggestion,
    playerColor,
    currentTurn,
  ]);

  // Update overlay when player color changes (board flip)
  useEffect(() => {
    if (overlayRef.current && isGameStarted) {
      overlayRef.current.setFlipped(playerColor === 'black');
    }
  }, [playerColor, isGameStarted]);
}
