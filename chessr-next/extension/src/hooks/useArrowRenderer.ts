/**
 * useArrowRenderer - Draws suggestion arrows on the chess board
 * Listens to suggestionStore and draws arrows when suggestions are available
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Chess } from "chess.js";
import { useTranslation } from "react-i18next";
import { useGameStore } from "../stores/gameStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  useSuggestionStore,
  type Suggestion,
  type ConfidenceLabel,
} from "../stores/suggestionStore";
import { useOpeningStore } from "../stores/openingStore";
import { useStreamerModeStore } from "../stores/streamerModeStore";
import { useBoardContextStore } from "../stores/boardContextStore";
import { useOpeningTracker } from "./useOpeningTracker";
import { useAlternativeOpenings } from "./useAlternativeOpenings";
import { OverlayManager } from "../content/overlay/OverlayManager";
import { ArrowRenderer, type Badge } from "../content/overlay/ArrowRenderer";

// Confidence label to badge type key (for color mapping)
const CONFIDENCE_TYPES: Record<ConfidenceLabel, string> = {
  very_reliable: "best",
  reliable: "safe",
  playable: "ok",
  risky: "risky",
  speculative: "risky",
};

// Confidence label to i18n key
const CONFIDENCE_I18N: Record<ConfidenceLabel, string> = {
  very_reliable: "boardBadgeBest",
  reliable: "boardBadgeSafe",
  playable: "boardBadgeOk",
  risky: "boardBadgeRisky",
  speculative: "boardBadgeRisky",
};

// Piece symbols for capture badges
const PIECE_SYMBOLS: Record<string, string> = {
  p: "♟",
  n: "♞",
  b: "♝",
  r: "♜",
  q: "♛",
  k: "♚",
};

// Piece name i18n keys for promotion
const PIECE_I18N: Record<string, string> = {
  q: "boardPieceQueen",
  r: "boardPieceRook",
  b: "boardPieceBishop",
  n: "boardPieceKnight",
};

/**
 * Build badges for a suggestion
 */
function buildBadges(
  suggestion: Suggestion,
  fen: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Badge[] {
  const badges: Badge[] = [];

  // Quality badge
  badges.push({
    type: CONFIDENCE_TYPES[suggestion.confidenceLabel],
    label: t(CONFIDENCE_I18N[suggestion.confidenceLabel]),
  });

  // Compute move flags using chess.js
  try {
    const chess = new Chess(fen);
    const from = suggestion.move.slice(0, 2);
    const to = suggestion.move.slice(2, 4);
    const promotion =
      suggestion.move.length === 5 ? suggestion.move[4] : undefined;

    const move = chess.move({ from, to, promotion });
    if (move) {
      // Mate badge
      if (suggestion.mateScore !== undefined && suggestion.mateScore !== null) {
        badges.push({
          type: "mate",
          label: t("boardBadgeMateIn", {
            count: Math.abs(suggestion.mateScore),
          }),
        });
      } else if (chess.isCheckmate()) {
        badges.push({ type: "mate", label: t("boardBadgeMate") });
      } else if (chess.isCheck()) {
        badges.push({ type: "check", label: t("boardBadgeCheck") });
      }

      // Capture badge
      if (move.captured) {
        badges.push({
          type: "capture",
          label: `x ${PIECE_SYMBOLS[move.captured] || ""}`,
        });
      }

      // Promotion badge
      if (move.promotion) {
        const pieceName = t(PIECE_I18N[move.promotion] || "boardPieceQueen");
        badges.push({
          type: "promotion",
          label: `${PIECE_SYMBOLS[move.promotion] || "♛"} ${pieceName}`,
        });
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
function detectPlatform(): "chesscom" | "lichess" | "worldchess" {
  const hostname = window.location.hostname;
  if (hostname.includes("lichess.org")) return "lichess";
  if (hostname.includes("worldchess.com")) return "worldchess";
  return "chesscom";
}

/**
 * Find the chess board element (platform-aware)
 */
function findBoardElement(): HTMLElement | null {
  const platform = detectPlatform();

  if (platform === "lichess") {
    return document.querySelector("cg-board") as HTMLElement | null;
  }

  if (platform === "worldchess") {
    return document.querySelector(
      '[data-component="GameBoardCenter"] cg-board[data-cg-type="board"]',
    ) as HTMLElement | null;
  }

  // Chess.com
  return document.querySelector(
    "wc-chess-board, chess-board, .chessboard",
  ) as HTMLElement | null;
}

/**
 * Check if the board is flipped (black's perspective) - platform-aware
 */
function isBoardFlipped(): boolean {
  const platform = detectPlatform();

  if (platform === "lichess") {
    const cgWrap = document.querySelector(".cg-wrap");
    return cgWrap?.classList.contains("orientation-black") ?? false;
  }

  if (platform === "worldchess") {
    // WorldChess: board has transform rotate(180deg) when flipped
    const board = findBoardElement();
    if (!board) return false;
    return (board.style.transform || "").includes("rotate(180deg)");
  }

  // Chess.com
  const board = findBoardElement();
  if (!board) return false;

  return (
    board.classList.contains("flipped") ||
    board.closest(".flipped") !== null ||
    board.getAttribute("flipped") === "true"
  );
}

export function useArrowRenderer() {
  const { t } = useTranslation("game");
  const { isGameStarted, playerColor, currentTurn, chessInstance } =
    useGameStore();
  const {
    suggestions,
    suggestedFen,
    selectedIndex,
    hoveredIndex,
    showingPvIndex,
    showingOpeningMoves,
    showingAlternativeIndex,
  } = useSuggestionStore();
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
  const isStreamerTabOpen = useStreamerModeStore((s) => s.isStreamerTabOpen);
  const boardGameOver = useBoardContextStore((s) => s.isGameOver);
  const openingTracker = useOpeningTracker();
  const { alternatives } = useAlternativeOpenings(openingTracker.hasDeviated);

  const overlayRef = useRef<OverlayManager | null>(null);
  const rendererRef = useRef<ArrowRenderer | null>(null);
  const isInitializedRef = useRef(false);

  // Counter to trigger re-render when board resizes
  const [resizeCounter, setResizeCounter] = useState(0);

  // Callback for resize events
  const handleResize = useCallback(() => {
    rendererRef.current?.clearMeasureCache();
    setResizeCounter((c) => c + 1);
  }, []);

  // Initialize overlay when game starts
  useEffect(() => {
    if (!isGameStarted) {
      if (overlayRef.current) {
        overlayRef.current.offResize(handleResize);
        overlayRef.current.destroy();
        overlayRef.current = null;
        rendererRef.current = null;
        isInitializedRef.current = false;
      }
      return;
    }

    // Find board — on WorldChess SPA, the main board may not be rendered yet
    let boardElement = findBoardElement();

    if (!boardElement) {
      // Poll for the board every 300ms up to 5s (SPA async rendering)
      let attempts = 0;
      const pollTimer = setInterval(() => {
        attempts++;
        if (attempts > 16 || !isGameStarted) { clearInterval(pollTimer); return; }
        const board = findBoardElement();
        if (board && !isInitializedRef.current) {
          clearInterval(pollTimer);
          const overlay = new OverlayManager();
          overlay.initialize(board, isBoardFlipped());
          overlay.onResize(handleResize);
          overlayRef.current = overlay;
          rendererRef.current = new ArrowRenderer(overlay);
          isInitializedRef.current = true;
          overlay.setFlipped(playerColor === "black");
        }
      }, 300);
      return () => clearInterval(pollTimer);
    }

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
      overlayRef.current.setFlipped(playerColor === "black");
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
    if (!renderer) {
      console.log(`%c[chessr.io] [Arrow] No renderer, skipping. isInitialized=${isInitializedRef.current}, overlay=${!!overlayRef.current}`, 'color: #f59e0b');
      return;
    }

    // Hide arrows when streamer mode is active or game is over
    if (isStreamerTabOpen || boardGameOver || document.querySelector('.game-review-emphasis-component')) {
      renderer.clear();
      renderer.clearOpeningArrows();
      return;
    }

    // Clear previous arrows
    renderer.clear();
    renderer.clearOpeningArrows();

    // Get current FEN for various checks
    const currentFen = chessInstance?.fen();

    // Helper function to draw PV-style arrows (used for both engine PV and opening sequence)
    const drawPvSequence = (
      moves: { from: string; to: string }[],
      startingFen: string,
    ) => {
      let isWhiteToMove = startingFen.includes(" w ");
      for (let i = 0; i < moves.length; i++) {
        const { from, to } = moves[i];
        const arrowColor = isWhiteToMove
          ? "rgba(255, 255, 255, 0.95)"
          : "rgba(40, 40, 40, 0.95)";
        const textColor = isWhiteToMove ? "black" : "white";
        renderer.drawPvArrow({
          from,
          to,
          color: arrowColor,
          textColor,
          moveNumber: i + 1,
        });
        isWhiteToMove = !isWhiteToMove;
      }
      renderer.flushPvCircles();
    };

    // Check if we're showing an alternative opening preview (independent of turn/suggestions)
    const isShowingAlternative =
      showingAlternativeIndex !== null && alternatives[showingAlternativeIndex];

    // Draw alternative opening preview arrows (works regardless of turn or suggestions)
    if (isShowingAlternative && currentFen) {
      try {
        const chess = new Chess(currentFen);
        const pvMoves: { from: string; to: string }[] = [];

        const altOpening = alternatives[showingAlternativeIndex!];
        const altMoves = altOpening.moves
          .replace(/\d+\.\s*/g, "")
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
    if (
      openingTracker.hasDeviated &&
      alternatives.length > 0 &&
      currentFen &&
      isPlayerTurn
    ) {
      const altArrowData: {
        from: string;
        to: string;
        rank: number;
        length: number;
      }[] = [];

      for (let i = 0; i < alternatives.length; i++) {
        const alt = alternatives[i];
        const altMoves = alt.moves
          .replace(/\d+\.\s*/g, "")
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
          label: showDetailedMoveSuggestion
            ? t("boardBadgeAlt", { rank: arrow.rank })
            : undefined,
        });
      }
    }

    // Only show engine arrows on player's turn
    if (!isPlayerTurn) {
      // Not player turn, skip
      return;
    }

    // No suggestions to draw
    if (!suggestions || suggestions.length === 0) {
      // No suggestions, skip
      return;
    }

    // Check if suggestions are for current position
    if (!currentFen || suggestedFen !== currentFen) {
      // FEN mismatch, waiting for new suggestions
      return;
    }

    // Check if we're showing a PV sequence (engine or opening) - these are mutually exclusive with regular arrows
    const isShowingEnginePv =
      showingPvIndex !== null && suggestions[showingPvIndex]?.pv;
    const isShowingOpeningSequence =
      showingOpeningMoves &&
      showOpeningArrows &&
      openingTracker.isFollowingOpening &&
      !openingTracker.hasDeviated &&
      openingTracker.openingMoves;

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
          const remainingMoves = openingTracker.openingMoves!.slice(
            openingTracker.currentMoveIndex,
          );
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
    if (
      showOpeningArrows &&
      openingTracker.isFollowingOpening &&
      !openingTracker.hasDeviated &&
      openingTracker.nextOpeningMoveUci
    ) {
      const openingParsed = parseUciMove(openingTracker.nextOpeningMoveUci);
      if (openingParsed) {
        renderer.drawOpeningArrow({
          from: openingParsed.from,
          to: openingParsed.to,
          color: openingArrowColor,
          winRate: 0,
          label: showDetailedMoveSuggestion
            ? t("boardBadgeOpening")
            : undefined,
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

    // Build arrow data with length for sorting
    const arrowData: {
      from: string;
      to: string;
      color: string;
      opacity: number;
      length: number;
      badges: Badge[];
      rank: number;
    }[] = [];

    suggestionsToShow.forEach((suggestion, index) => {
      const parsed = parseUciMove(suggestion.move);
      if (!parsed) return;

      // Build badges if setting is enabled
      const badges =
        showDetailedMoveSuggestion && currentFen
          ? buildBadges(suggestion, currentFen, t)
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

    // Trigger repaint without forcing synchronous layout
    const svg = overlayRef.current?.getSVG();
    if (svg) {
      requestAnimationFrame(() => { svg.style.opacity = '1'; });
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
    isStreamerTabOpen, // Hide arrows in streamer mode
    t, // Trigger redraw on language change
  ]);

  // Update overlay when player color changes (board flip)
  useEffect(() => {
    if (overlayRef.current && isGameStarted) {
      overlayRef.current.setFlipped(playerColor === "black");
    }
  }, [playerColor, isGameStarted]);
}
