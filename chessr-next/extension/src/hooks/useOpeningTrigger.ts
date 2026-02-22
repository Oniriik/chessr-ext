/**
 * useOpeningTrigger - Auto-fetch opening data when position changes
 */

import { useEffect, useRef } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useOpeningStore } from '../stores/openingStore';
import { fetchOpeningData } from '../lib/openingBook';
import { logger } from '../lib/logger';

const MAX_OPENING_MOVES = 25; // Stop checking after 25 half-moves (~12 full moves)

/**
 * Hook that automatically fetches opening data when:
 * 1. Game is started
 * 2. Position has changed
 * 3. We're still in the opening phase (< 25 moves)
 * 4. Opening arrows are enabled
 */
export function useOpeningTrigger() {
  const { isGameStarted, chessInstance, moveHistory } = useGameStore();
  const {
    showOpeningArrows,
    showOpeningCard,
    setOpeningData,
    setLoading,
    setError,
    markOutOfBook,
    reset,
    isInBook,
    openingName,
    previousOpeningName,
  } = useOpeningStore();

  const lastFen = useRef<string | null>(null);

  // Main effect for position changes
  useEffect(() => {
    // Check if opening features are enabled
    if (!showOpeningArrows && !showOpeningCard) {
      return;
    }

    // Check if game is started
    if (!isGameStarted || !chessInstance) {
      return;
    }

    // Skip if we're past the opening phase
    if (moveHistory.length > MAX_OPENING_MOVES) {
      if (isInBook) {
        markOutOfBook(moveHistory.length);
        logger.log('[opening] Past opening phase, marking out of book');
      }
      return;
    }

    const fen = chessInstance.fen();

    // Skip if position hasn't changed
    if (fen === lastFen.current) {
      return;
    }

    lastFen.current = fen;
    setLoading(true);

    fetchOpeningData(fen)
      .then((data) => {
        setOpeningData(data);

        // Log opening transitions
        if (data.opening?.name && previousOpeningName && data.opening.name !== previousOpeningName) {
          logger.log(`[opening] Transition: ${previousOpeningName} → ${data.opening.name}`);
        }

        // Log when we leave the book
        if (!data.isInBook && isInBook) {
          logger.log(`[opening] Out of book at move ${moveHistory.length}`);
          markOutOfBook(moveHistory.length);
        }
      })
      .catch((error) => {
        logger.error('[opening] Failed to fetch opening data:', error);
        setError(error.message);
      });
  }, [
    isGameStarted,
    chessInstance,
    moveHistory.length,
    showOpeningArrows,
    showOpeningCard,
    setOpeningData,
    setLoading,
    setError,
    markOutOfBook,
    isInBook,
    previousOpeningName,
  ]);

  // Reset when game ends
  useEffect(() => {
    if (!isGameStarted) {
      lastFen.current = null;
      reset();
    }
  }, [isGameStarted, reset]);

  // Log opening name when it changes
  useEffect(() => {
    if (openingName) {
      logger.log(`[opening] Current: ${openingName}`);
    }
  }, [openingName]);
}
