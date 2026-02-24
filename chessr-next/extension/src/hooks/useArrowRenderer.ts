/**
 * useArrowRenderer - Draws suggestion arrows on the chess board
 * Listens to suggestionStore and draws arrows when suggestions are available
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSuggestionStore, type Suggestion, type ConfidenceLabel } from '../stores/suggestionStore';
import { useOpeningStore } from '../stores/openingStore';
import { useOpeningTracker } from './useOpeningTracker';
import { useAlternativeOpenings } from './useAlternativeOpenings';
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
 * Detect current platform from hostname
 */
function detectPlatform(): 'chesscom' | 'lichess' {
  const hostname = window.location.hostname;
  if (hostname.includes('lichess.org')) return 'lichess';
  return 'chesscom';
}

/**
 * Find the chess board element (platform-aware)
 */
function findBoardElement(): HTMLElement | null {
  const platform = detectPlatform();

  if (platform === 'lichess') {
    // Lichess: cg-board is the actual board element
    return document.querySelector('cg-board') as HTMLElement | null;
  }

  // Chess.com
  return document.querySelector('wc-chess-board, chess-board, .chessboard') as HTMLElement | null;
}

/**
 * Check if the board is flipped (black's perspective) - platform-aware
 */
function isBoardFlipped(): boolean {
  const platform = detectPlatform();

  if (platform === 'lichess') {
    // Lichess: check cg-wrap orientation class
    const cgWrap = document.querySelector('.cg-wrap');
    return cgWrap?.classList.contains('orientation-black') ?? false;
  }

  // Chess.com
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
  const { suggestions, suggestedFen, selectedIndex, hoveredIndex, showingPvIndex, showingOpeningMoves, showingAlternativeIndex } = useSuggestionStore();
  const {
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
    showDetailedMoveSuggestion,
  } = useSettingsStore();
  const { showOpeningArrows, openingArrowColor } = useOpeningStore();
  const openingTracker = useOpeningTracker();
  const { alternatives } = useAlternativeOpenings(openingTracker.hasDeviated);

  const overlayRef = useRef<OverlayManager | null>(null);
  const rendererRef = useRef<ArrowRenderer | null>(null);
  const isInitializedRef = useRef(false);

  // Counter to trigger re-render when board resizes
  const [resizeCounter, setResizeCounter] = useState(0);

  // Callback for resize events
  const handleResize = useCallback(() => {
    setResizeCounter(c => c + 1);
  }, []);

  // Initialize overlay when game starts
  useEffect(() => {
    if (!isGameStarted) {
      // Clean up when game ends
      if (overlayRef.current) {
        overlayRef.current.offResize(handleResize);
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

      // Register resize callback
      overlay.onResize(handleResize);

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
    renderer.clearOpeningArrows();

    // Get current FEN for various checks
    const currentFen = chessInstance?.fen();

    // Helper function to draw PV-style arrows (used for both engine PV and opening sequence)
    const drawPvSequence = (moves: { from: string; to: string }[], startingFen: string) => {
      let isWhiteToMove = startingFen.includes(' w ');
      for (let i = 0; i < moves.length; i++) {
        const { from, to } = moves[i];
        const arrowColor = isWhiteToMove ? 'rgba(255, 255, 255, 0.95)' : 'rgba(40, 40, 40, 0.95)';
        const textColor = isWhiteToMove ? 'black' : 'white';
        renderer.drawPvArrow({ from, to, color: arrowColor, textColor, moveNumber: i + 1 });
        isWhiteToMove = !isWhiteToMove;
      }
      renderer.flushPvCircles();
    };

    // Check if we're showing an alternative opening preview (independent of turn/suggestions)
    const isShowingAlternative = showingAlternativeIndex !== null && alternatives[showingAlternativeIndex];

    // Draw alternative opening preview arrows (works regardless of turn or suggestions)
    if (isShowingAlternative && currentFen) {
      try {
        const chess = new Chess(currentFen);
        const pvMoves: { from: string; to: string }[] = [];

        const altOpening = alternatives[showingAlternativeIndex!];
        const altMoves = altOpening.moves
          .replace(/\d+\.\s*/g, '')
          .split(/\s+/)
          .filter((m: string) => m.length > 0);
        // Start from current move index (skip already played moves)
        const remainingMoves = altMoves.slice(openingTracker.currentMoveIndex);
        for (const sanMove of remainingMoves) {
          const move = chess.move(sanMove);
          if (!move) break;
          pvMoves.push({ from: move.from, to: move.to });
        }

        if (pvMoves.length > 0) {
          drawPvSequence(pvMoves, currentFen);
        }
      } catch {
        // Ignore errors in alternative PV drawing
      }
      return; // Don't draw regular arrows when showing alternative preview
    }

    // Draw alternative opening arrows when deviated (numbered arrows for each alternative's next move)
    // Uses opening arrow style - simple stacking without hover conflict handling
    // Only show when it's the player's turn
    const isPlayerTurn = playerColor === currentTurn;
    if (openingTracker.hasDeviated && alternatives.length > 0 && currentFen && isPlayerTurn) {
      const altArrowData: { from: string; to: string; rank: number; length: number }[] = [];

      for (let i = 0; i < alternatives.length; i++) {
        const alt = alternatives[i];
        const altMoves = alt.moves
          .replace(/\d+\.\s*/g, '')
          .split(/\s+/)
          .filter((m: string) => m.length > 0);

        // Get the next move to play (at currentMoveIndex)
        const nextMoveIndex = openingTracker.currentMoveIndex;
        if (nextMoveIndex < altMoves.length) {
          const nextMoveSan = altMoves[nextMoveIndex];
          try {
            const chess = new Chess(currentFen);
            const move = chess.move(nextMoveSan);
            if (move) {
              altArrowData.push({
                from: move.from,
                to: move.to,
                rank: i + 1,
                length: getArrowLength(move.from, move.to),
              });
            }
          } catch {
            // Ignore errors
          }
        }
      }

      // Sort by length descending (longest first, so shortest appears on top)
      altArrowData.sort((a, b) => b.length - a.length);

      // Draw the alternative arrows using opening arrow color from settings
      for (const arrow of altArrowData) {
        renderer.drawOpeningArrow({
          from: arrow.from,
          to: arrow.to,
          color: openingArrowColor,
          winRate: 0,
          label: showDetailedMoveSuggestion ? `Alt ${arrow.rank}` : undefined, // Alt 1, Alt 2, Alt 3
        });
      }
    }

    // Only show engine arrows on player's turn
    if (!isPlayerTurn) return;

    // No suggestions to draw
    if (!suggestions || suggestions.length === 0) return;

    // Check if suggestions are for current position
    if (!currentFen || suggestedFen !== currentFen) {
      logger.log('Suggestions are stale, waiting for new ones');
      return;
    }

    // Check if we're showing a PV sequence (engine or opening) - these are mutually exclusive with regular arrows
    const isShowingEnginePv = showingPvIndex !== null && suggestions[showingPvIndex]?.pv;
    const isShowingOpeningSequence = showingOpeningMoves && showOpeningArrows && openingTracker.isFollowingOpening && !openingTracker.hasDeviated && openingTracker.openingMoves;

    // If showing any PV sequence, draw it and skip everything else
    if (isShowingEnginePv || isShowingOpeningSequence) {
      try {
        const chess = new Chess(currentFen);
        const pvMoves: { from: string; to: string }[] = [];

        if (isShowingEnginePv) {
          // Engine PV - parse UCI moves
          const uciMoves = suggestions[showingPvIndex!].pv!;
          for (const uciMove of uciMoves) {
            const from = uciMove.slice(0, 2);
            const to = uciMove.slice(2, 4);
            const promotion = uciMove.length === 5 ? uciMove[4] : undefined;
            const move = chess.move({ from, to, promotion });
            if (!move) break;
            pvMoves.push({ from: move.from, to: move.to });
          }
        } else {
          // Opening sequence - parse SAN moves
          const remainingMoves = openingTracker.openingMoves!.slice(openingTracker.currentMoveIndex);
          for (const sanMove of remainingMoves) {
            const move = chess.move(sanMove);
            if (!move) break;
            pvMoves.push({ from: move.from, to: move.to });
          }
        }

        if (pvMoves.length > 0) {
          drawPvSequence(pvMoves, currentFen);
        }
      } catch {
        // Ignore errors in PV drawing
      }
      return; // Don't draw regular arrows when showing PV
    }

    // Draw opening arrow (single arrow for next move)
    if (showOpeningArrows && openingTracker.isFollowingOpening && !openingTracker.hasDeviated && openingTracker.nextOpeningMoveUci) {
      const openingParsed = parseUciMove(openingTracker.nextOpeningMoveUci);
      if (openingParsed) {
        logger.log(`[opening-arrow] Drawing arrow for ${openingTracker.nextOpeningMove} (${openingParsed.from} → ${openingParsed.to})`);
        renderer.drawOpeningArrow({
          from: openingParsed.from,
          to: openingParsed.to,
          color: openingArrowColor,
          winRate: 0,
          label: showDetailedMoveSuggestion ? 'Opening' : undefined,
        });
      }
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

    // Set the selected/hovered index for conflict handling
    renderer.setSelectedIndex(selectedIndex);
    renderer.setHoveredIndex(hoveredIndex);

    // Draw regular suggestion arrows
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
    selectedIndex,
    hoveredIndex,
    showingPvIndex,
    showingOpeningMoves,
    showingAlternativeIndex,
    alternatives,
    showOpeningArrows,
    openingArrowColor,
    openingTracker.isFollowingOpening,
    openingTracker.nextOpeningMoveUci,
    openingTracker.hasDeviated,
    openingTracker.nextOpeningMove,
    openingTracker.openingMoves,
    openingTracker.currentMoveIndex,
    resizeCounter, // Trigger redraw when board resizes
  ]);

  // Update overlay when player color changes (board flip)
  useEffect(() => {
    if (overlayRef.current && isGameStarted) {
      overlayRef.current.setFlipped(playerColor === 'black');
    }
  }, [playerColor, isGameStarted]);
}
