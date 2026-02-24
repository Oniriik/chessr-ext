/**
 * useOpeningArrowRenderer - Draws opening arrow for the selected opening
 * Shows a violet arrow for the next move in the player's selected opening
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useOpeningStore } from '../stores/openingStore';
import { useOpeningTracker } from './useOpeningTracker';
import { OverlayManager } from '../content/overlay/OverlayManager';
import { ArrowRenderer } from '../content/overlay/ArrowRenderer';
import { logger } from '../lib/logger';

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
 * Convert UCI move (e.g., "e2e4") to from/to squares
 */
function parseUciMove(uciMove: string): { from: string; to: string } | null {
  if (uciMove.length < 4) return null;
  return {
    from: uciMove.slice(0, 2),
    to: uciMove.slice(2, 4),
  };
}

export function useOpeningArrowRenderer() {
  const { isGameStarted, playerColor, currentTurn } = useGameStore();
  const { showOpeningArrows, openingArrowColor } = useOpeningStore();
  const openingTracker = useOpeningTracker();

  const overlayRef = useRef<OverlayManager | null>(null);
  const rendererRef = useRef<ArrowRenderer | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize overlay when game starts
  useEffect(() => {
    if (!isGameStarted || !showOpeningArrows) {
      // Clean up when game ends or arrows disabled
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
      overlay.initialize(boardElement, playerColor === 'black');

      overlayRef.current = overlay;
      rendererRef.current = new ArrowRenderer(overlay);
      isInitializedRef.current = true;

      logger.log('[opening] Arrow renderer initialized');
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
  }, [isGameStarted, playerColor, showOpeningArrows]);

  // Draw opening arrow for selected opening
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    // Clear previous opening arrows
    renderer.clearOpeningArrows();

    // Only show arrows on player's turn
    const isPlayerTurn = playerColor === currentTurn;
    if (!isPlayerTurn) {
      return;
    }

    // Skip if opening arrows are disabled
    if (!showOpeningArrows) {
      return;
    }

    // Skip if no selected opening, deviated, or no next move
    const {
      selectedOpening,
      isFollowingOpening,
      nextOpeningMoveUci,
      hasDeviated,
      isOpeningComplete,
    } = openingTracker;

    if (!selectedOpening || hasDeviated || isOpeningComplete || !isFollowingOpening) {
      return;
    }

    if (!nextOpeningMoveUci) {
      return;
    }

    // Parse the UCI move
    const parsed = parseUciMove(nextOpeningMoveUci);
    if (!parsed) return;

    logger.log(
      `[opening-arrow] Drawing arrow for ${openingTracker.nextOpeningMove} (${parsed.from} → ${parsed.to})`
    );

    // Draw the opening arrow
    renderer.drawOpeningArrow({
      from: parsed.from,
      to: parsed.to,
      color: openingArrowColor,
      winRate: 0,
      label: 'Opening', // Show "Opening" badge instead of winrate
    });
  }, [
    openingTracker.selectedOpening,
    openingTracker.isFollowingOpening,
    openingTracker.nextOpeningMoveUci,
    openingTracker.hasDeviated,
    openingTracker.isOpeningComplete,
    playerColor,
    currentTurn,
    showOpeningArrows,
    openingArrowColor,
  ]);

  // Update overlay when player color changes (board flip)
  useEffect(() => {
    if (overlayRef.current && isGameStarted) {
      overlayRef.current.setFlipped(playerColor === 'black');
    }
  }, [playerColor, isGameStarted]);
}
