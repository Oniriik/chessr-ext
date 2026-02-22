/**
 * useOpeningTracker - Tracks if the player is following their selected opening
 * Returns the next opening move to suggest and deviation status
 */

import { useMemo } from 'react';
import { Chess } from 'chess.js';
import { useGameStore, useFEN } from '../stores/gameStore';
import { useOpeningStore, type SavedOpening } from '../stores/openingStore';
import { logger } from '../lib/logger';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface OpeningTrackerResult {
  // The selected opening for the player's color
  selectedOpening: SavedOpening | null;

  // Is the player following the opening?
  isFollowingOpening: boolean;

  // The next opening move (if it's the player's turn)
  nextOpeningMove: string | null; // SAN format: "Nf3"
  nextOpeningMoveUci: string | null; // UCI format: "g1f3"

  // Is the opening complete? (all moves played)
  isOpeningComplete: boolean;

  // Has the player/opponent deviated?
  hasDeviated: boolean;
  deviatedAtMove: number | null;

  // Opening moves as array
  openingMoves: string[];

  // Current move index (how many moves played so far)
  currentMoveIndex: number;
}

/**
 * Parse opening moves from SAN string
 * "1. e4 e5 2. Nf3 Nc6 3. Bc4" → ["e4", "e5", "Nf3", "Nc6", "Bc4"]
 */
function parseOpeningMoves(movesString: string): string[] {
  return movesString
    .replace(/\d+\.\s*/g, '') // Remove move numbers like "1. ", "2. "
    .split(/\s+/)
    .filter((m) => m.length > 0);
}

/**
 * Convert a SAN move to UCI format using current FEN
 */
function sanToUci(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return move.from + move.to + (move.promotion || '');
  } catch {
    return null;
  }
}

export function useOpeningTracker(): OpeningTrackerResult {
  const { playerColor, moveHistory, currentTurn, isGameStarted } = useGameStore();
  const { repertoire } = useOpeningStore();
  const fen = useFEN();

  return useMemo(() => {
    // Default result
    const defaultResult: OpeningTrackerResult = {
      selectedOpening: null,
      isFollowingOpening: false,
      nextOpeningMove: null,
      nextOpeningMoveUci: null,
      isOpeningComplete: false,
      hasDeviated: false,
      deviatedAtMove: null,
      openingMoves: [],
      currentMoveIndex: 0,
    };

    // No game or player color
    if (!isGameStarted || !playerColor) {
      return defaultResult;
    }

    // Get the selected opening for the player's color
    const selectedOpening = playerColor === 'white' ? repertoire.white : repertoire.black;

    if (!selectedOpening) {
      return defaultResult;
    }

    // Parse opening moves
    const openingMoves = parseOpeningMoves(selectedOpening.moves);

    if (openingMoves.length === 0) {
      return { ...defaultResult, selectedOpening };
    }

    const currentMoveIndex = moveHistory.length;

    // Check if opening is complete
    if (currentMoveIndex >= openingMoves.length) {
      logger.log(`[opening-tracker] Opening "${selectedOpening.name}" complete`);
      return {
        selectedOpening,
        isFollowingOpening: true,
        nextOpeningMove: null,
        nextOpeningMoveUci: null,
        isOpeningComplete: true,
        hasDeviated: false,
        deviatedAtMove: null,
        openingMoves,
        currentMoveIndex,
      };
    }

    // Check if moves match the opening
    for (let i = 0; i < currentMoveIndex; i++) {
      if (i >= openingMoves.length) break;

      // Compare moves (case-insensitive for safety)
      if (moveHistory[i] !== openingMoves[i]) {
        logger.log(
          `[opening-tracker] Deviated at move ${i + 1}: expected ${openingMoves[i]}, got ${moveHistory[i]}`
        );
        return {
          selectedOpening,
          isFollowingOpening: false,
          nextOpeningMove: null,
          nextOpeningMoveUci: null,
          isOpeningComplete: false,
          hasDeviated: true,
          deviatedAtMove: i,
          openingMoves,
          currentMoveIndex,
        };
      }
    }

    // Find the next move for the player
    // White moves at index 0, 2, 4... (even)
    // Black moves at index 1, 3, 5... (odd)
    const isPlayerTurn = currentTurn === playerColor;

    logger.log(
      `[opening-tracker] State: playerColor=${playerColor}, currentTurn=${currentTurn}, isPlayerTurn=${isPlayerTurn}, currentMoveIndex=${currentMoveIndex}`
    );

    let nextOpeningMove: string | null = null;
    let nextOpeningMoveUci: string | null = null;

    // Find the next player move in the opening sequence
    // If it's player's turn: next move is at currentMoveIndex
    // If it's opponent's turn: next player move is at currentMoveIndex + 1
    const nextPlayerMoveIndex = isPlayerTurn ? currentMoveIndex : currentMoveIndex + 1;

    if (nextPlayerMoveIndex < openingMoves.length) {
      nextOpeningMove = openingMoves[nextPlayerMoveIndex];

      // Only compute UCI when it's the player's turn (for arrow drawing)
      if (isPlayerTurn) {
        const currentFen = fen || STARTING_FEN;
        nextOpeningMoveUci = sanToUci(currentFen, nextOpeningMove);

        logger.log(
          `[opening-tracker] Following "${selectedOpening.name}", next move: ${nextOpeningMove} (${nextOpeningMoveUci}), fen: ${currentFen}`
        );
      }
    }

    return {
      selectedOpening,
      isFollowingOpening: true,
      nextOpeningMove,
      nextOpeningMoveUci,
      isOpeningComplete: false,
      hasDeviated: false,
      deviatedAtMove: null,
      openingMoves,
      currentMoveIndex,
    };
  }, [playerColor, moveHistory, currentTurn, isGameStarted, repertoire, fen]);
}
