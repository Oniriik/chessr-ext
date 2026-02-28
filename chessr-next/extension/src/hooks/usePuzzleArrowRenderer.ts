/**
 * usePuzzleArrowRenderer - Draws hint arrows on the puzzle board
 * Uses the opening arrow style (simple green arrow, no badges)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePuzzleStore } from '../stores/puzzleStore';
import { OverlayManager } from '../content/overlay/OverlayManager';
import { ArrowRenderer } from '../content/overlay/ArrowRenderer';
import { logger } from '../lib/logger';

// Arrow colors: green (best), orange (2nd), red (3rd)
const ARROW_COLORS = [
  'rgba(34, 197, 94, 0.95)',   // Best move - green
  'rgba(245, 158, 11, 0.85)',  // 2nd best - orange
  'rgba(239, 68, 68, 0.75)',   // 3rd best - red
];

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
    return document.querySelector('cg-board') as HTMLElement | null;
  }

  return document.querySelector('wc-chess-board, chess-board, .chessboard') as HTMLElement | null;
}

/**
 * Check if the board is flipped (black's perspective) - platform-aware
 */
function isBoardFlipped(): boolean {
  const platform = detectPlatform();

  if (platform === 'lichess') {
    const cgWrap = document.querySelector('.cg-wrap');
    return cgWrap?.classList.contains('orientation-black') ?? false;
  }

  const board = findBoardElement();
  if (!board) return false;

  return (
    board.classList.contains('flipped') ||
    board.closest('.flipped') !== null ||
    board.getAttribute('flipped') === 'true'
  );
}

/**
 * Parse UCI move (e.g., "e2e4") to from/to squares
 */
function parseUciMove(uciMove: string): { from: string; to: string } | null {
  if (uciMove.length < 4) return null;
  return {
    from: uciMove.slice(0, 2),
    to: uciMove.slice(2, 4),
  };
}

/**
 * Hook that renders hint arrows for puzzles
 */
export function usePuzzleArrowRenderer() {
  const { isStarted, playerColor, suggestions } = usePuzzleStore();

  const overlayRef = useRef<OverlayManager | null>(null);
  const rendererRef = useRef<ArrowRenderer | null>(null);
  const isInitializedRef = useRef(false);

  const [resizeCounter, setResizeCounter] = useState(0);

  const handleResize = useCallback(() => {
    setResizeCounter((c) => c + 1);
  }, []);

  // Initialize overlay when puzzle starts
  useEffect(() => {
    if (!isStarted) {
      // Clean up when puzzle ends
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

      overlay.onResize(handleResize);

      overlayRef.current = overlay;
      rendererRef.current = new ArrowRenderer(overlay);
      isInitializedRef.current = true;

      logger.log('[puzzle-arrow] Overlay initialized');
    }

    // Update flipped state
    if (overlayRef.current) {
      overlayRef.current.setFlipped(playerColor === 'black');
    }

    return () => {
      if (overlayRef.current) {
        overlayRef.current.destroy();
        overlayRef.current = null;
        rendererRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, [isStarted, playerColor, handleResize]);

  // Draw arrows when suggestions change
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Clear previous arrows
    renderer.clear();

    // No suggestions to draw
    if (!suggestions || suggestions.length === 0) return;

    logger.log(`[puzzle-arrow] Drawing ${suggestions.length} hints`);

    // Draw arrows in reverse order so best move is on top
    for (let i = suggestions.length - 1; i >= 0; i--) {
      const suggestion = suggestions[i];
      const parsed = parseUciMove(suggestion.move);
      if (!parsed) {
        logger.log('[puzzle-arrow] Invalid move format:', suggestion.move);
        continue;
      }

      const color = ARROW_COLORS[i] || ARROW_COLORS[ARROW_COLORS.length - 1];
      const label = i === 0 ? 'Best' : `#${i + 1}`;

      logger.log(`[puzzle-arrow] Drawing hint ${i + 1}: ${parsed.from} → ${parsed.to}`);

      renderer.drawOpeningArrow({
        from: parsed.from,
        to: parsed.to,
        color,
        winRate: suggestion.winRate || 0,
        label,
      });
    }
  }, [suggestions, resizeCounter]);

  // Update overlay when player color changes (board flip)
  useEffect(() => {
    if (overlayRef.current && isStarted) {
      overlayRef.current.setFlipped(playerColor === 'black');
    }
  }, [playerColor, isStarted]);
}
