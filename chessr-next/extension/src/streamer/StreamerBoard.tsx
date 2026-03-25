import { useEffect, useRef, useState, useCallback } from 'react';
import { Chessground } from 'chessground';
import { GripHorizontal } from 'lucide-react';
import { useGameStore } from '../stores/gameStore';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useOpeningStore } from '../stores/openingStore';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { StreamerEvalBar } from './StreamerEvalBar';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';


export function StreamerBoard() {
  const boardRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);
  const [boardSize, setBoardSize] = useState<number>(() =>
    Math.min(window.innerWidth * 0.6, window.innerHeight * 0.7)
  );
  const dragging = useRef(false);
  const dragStart = useRef({ y: 0, size: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { y: e.clientY, size: boardSize };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [boardSize]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientY - dragStart.current.y;
    const max = Math.min(window.innerWidth * 0.85, window.innerHeight * 0.85);
    const newSize = Math.max(200, Math.min(dragStart.current.size + delta, max));
    setBoardSize(newSize);
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Clamp board size when window is resized so the board stays visible
  useEffect(() => {
    const handleResize = () => {
      setBoardSize((prev) => {
        const maxW = window.innerWidth * 0.85;
        const maxH = window.innerHeight * 0.85;
        const max = Math.min(maxW, maxH);
        return prev > max ? max : prev;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { isGameStarted, playerColor, chessInstance } = useGameStore();
  const puzzle = usePuzzleStore();
  const { suggestions, suggestedFen, showingPvIndex, showingOpeningMoves } = useSuggestionStore();
  const {
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
  } = useSettingsStore();
  const { showOpeningArrows, openingArrowColor } = useOpeningStore();

  // In puzzle mode, use puzzle FEN and orientation
  const isPuzzleMode = puzzle.isStarted && !isGameStarted;
  const currentFen = isPuzzleMode
    ? (puzzle.currentFen ?? 'start')
    : (chessInstance?.fen() ?? 'start');
  const boardOrientation = isPuzzleMode
    ? (puzzle.playerColor === 'black' ? 'black' : 'white')
    : (playerColor === 'black' ? 'black' : 'white');

  // Initialize chessground
  useEffect(() => {
    if (!boardRef.current) return;

    const cg = Chessground(boardRef.current, {
      fen: 'start',
      orientation: 'white',
      viewOnly: true,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      drawable: {
        enabled: false,
        visible: true,
      },
    });

    cgRef.current = cg;

    // Redraw chessground when the board container is resized
    const ro = new ResizeObserver(() => {
      cg.redrawAll();
    });
    ro.observe(boardRef.current);

    return () => {
      ro.disconnect();
      cg.destroy();
      cgRef.current = null;
    };
  }, []);

  // Update board position and orientation
  useEffect(() => {
    if (!cgRef.current) return;

    cgRef.current.set({
      fen: currentFen === 'start' ? undefined : currentFen,
      orientation: boardOrientation,
    });
  }, [currentFen, boardOrientation]);

  // Draw arrows (game mode or puzzle mode)
  useEffect(() => {
    if (!cgRef.current) return;

    const arrowShapes: DrawShape[] = [];

    // Puzzle mode: draw puzzle hint arrows
    if (isPuzzleMode) {
      if (puzzle.suggestions.length > 0) {
        puzzle.suggestions.forEach((s, index) => {
          if (s.move.length < 4) return;
          const brushes = ['green', 'blue', 'yellow'] as const;
          arrowShapes.push({
            orig: s.move.slice(0, 2) as Key,
            dest: s.move.slice(2, 4) as Key,
            brush: brushes[index] || 'green',
          });
        });
      }
      cgRef.current.setAutoShapes(arrowShapes);
      return;
    }

    // Game mode
    if (!isGameStarted || !suggestions.length || !suggestedFen) {
      cgRef.current.setAutoShapes(arrowShapes);
      return;
    }

    // Check FEN matches
    const gameFen = chessInstance?.fen() ?? 'start';
    if (suggestedFen !== gameFen) {
      cgRef.current.setAutoShapes(arrowShapes);
      return;
    }

    // If showing PV, draw PV arrows
    if (showingPvIndex !== null && suggestions[showingPvIndex]?.pv) {
      const pvMoves = suggestions[showingPvIndex].pv!;
      for (let i = 0; i < pvMoves.length; i++) {
        const move = pvMoves[i];
        if (move.length < 4) continue;
        arrowShapes.push({
          orig: move.slice(0, 2) as Key,
          dest: move.slice(2, 4) as Key,
          brush: i % 2 === 0 ? 'paleBlue' : 'paleRed',
        });
      }
      cgRef.current.setAutoShapes(arrowShapes);
      return;
    }

    // Draw suggestion arrows
    const suggestionsToShow = suggestions.slice(0, numberOfSuggestions);

    suggestionsToShow.forEach((suggestion, index) => {
      if (suggestion.move.length < 4) return;
      const brushes = ['green', 'blue', 'yellow'] as const;
      arrowShapes.push({
        orig: suggestion.move.slice(0, 2) as Key,
        dest: suggestion.move.slice(2, 4) as Key,
        brush: brushes[index] || 'green',
      });
    });

    cgRef.current.setAutoShapes(arrowShapes);
  }, [
    isPuzzleMode,
    puzzle.suggestions,
    isGameStarted,
    chessInstance,
    suggestions,
    suggestedFen,
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
    showOpeningArrows,
    openingArrowColor,
    showingPvIndex,
    showingOpeningMoves,
  ]);

  return (
    <div className="tw-flex tw-flex-col tw-items-center">
      <div className="tw-flex tw-gap-1.5" style={{ height: boardSize }}>
        <StreamerEvalBar />
        <div
          className="streamer-board-wrapper"
          style={{ width: boardSize, height: boardSize }}
        >
          <div
            ref={boardRef}
            className="streamer-board-inner"
          />
        </div>
      </div>
      {/* Resize handle */}
      <div
        className="streamer-resize-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripHorizontal className="tw-w-5 tw-h-5 tw-text-muted-foreground" />
      </div>
    </div>
  );
}
