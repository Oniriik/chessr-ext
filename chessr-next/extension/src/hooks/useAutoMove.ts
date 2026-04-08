import { useEffect, useRef, useCallback, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { executeAutoMove, executePremove, cancelPremoves } from '../lib/chesscom/executeAutoMove';
import { logger } from '../lib/logger';

const DEFAULT_MOVE_TIME_RANGE: [number, number] = [300, 800];
const DEFAULT_PREMOVE_TIME_RANGE: [number, number] = [100, 300];

function getRandomDelay(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

export function useAutoMove() {
  const [isAutoMoveEnabled, setIsAutoMoveEnabled] = useState(false);
  const [isAutoRematchEnabled, setIsAutoRematchEnabled] = useState(false);
  const [isPremoveEnabled, setIsPremoveEnabled] = useState(false);
  const [moveTimeRange, setMoveTimeRange] = useState<[number, number]>(DEFAULT_MOVE_TIME_RANGE);
  const [premoveTimeRange, setPremoveTimeRange] = useState<[number, number]>(DEFAULT_PREMOVE_TIME_RANGE);
  const lastPlayedFen = useRef<string | null>(null);
  const lastPremovedFen = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const premoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleAutoMove = useCallback(() => {
    setIsAutoMoveEnabled((prev) => !prev);
  }, []);

  const toggleAutoRematch = useCallback(() => {
    setIsAutoRematchEnabled((prev) => {
      const next = !prev;
      window.postMessage({ type: 'chessr:setAutoRematch', enabled: next }, '*');
      return next;
    });
  }, []);

  const togglePremove = useCallback(() => {
    setIsPremoveEnabled((prev) => {
      if (prev) cancelPremoves();
      return !prev;
    });
  }, []);

  // Auto-move: play best move on our turn
  useEffect(() => {
    if (!isAutoMoveEnabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      lastPlayedFen.current = null;
      return;
    }

    const unsub = useSuggestionStore.subscribe((state) => {
      const { suggestions, isLoading, suggestedFen } = state;
      const { isGameStarted, playerColor, currentTurn } = useGameStore.getState();

      if (!isGameStarted || isLoading || suggestions.length === 0 || !suggestedFen) return;
      if (playerColor !== currentTurn) return;
      if (suggestedFen === lastPlayedFen.current) return;

      if (timerRef.current) clearTimeout(timerRef.current);

      const delay = getRandomDelay(moveTimeRange);
      timerRef.current = setTimeout(() => {
        const bestMove = suggestions[0].move;
        logger.log(`[AutoMove] Playing ${bestMove} (delay: ${Math.round(delay)}ms)`);
        lastPlayedFen.current = suggestedFen;
        executeAutoMove(bestMove);
      }, delay);
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAutoMoveEnabled, moveTimeRange]);

  // Premove: queue next best move during opponent's turn
  useEffect(() => {
    if (!isPremoveEnabled) {
      if (premoveTimerRef.current) clearTimeout(premoveTimerRef.current);
      lastPremovedFen.current = null;
      return;
    }

    const unsub = useSuggestionStore.subscribe((state) => {
      const { suggestions, isLoading, suggestedFen } = state;
      const { isGameStarted, playerColor, currentTurn } = useGameStore.getState();

      if (!isGameStarted || isLoading || suggestions.length === 0 || !suggestedFen) return;
      // Only premove when it's NOT our turn (opponent is thinking)
      if (playerColor === currentTurn) return;
      if (suggestedFen === lastPremovedFen.current) return;

      if (premoveTimerRef.current) clearTimeout(premoveTimerRef.current);

      // Cancel previous premoves before setting new one
      cancelPremoves();

      const delay = getRandomDelay(premoveTimeRange);
      premoveTimerRef.current = setTimeout(() => {
        const bestMove = suggestions[0].move;
        logger.log(`[Premove] Queuing ${bestMove} (delay: ${Math.round(delay)}ms)`);
        lastPremovedFen.current = suggestedFen;
        executePremove(bestMove);
      }, delay);
    });

    return () => {
      unsub();
      if (premoveTimerRef.current) clearTimeout(premoveTimerRef.current);
    };
  }, [isPremoveEnabled, premoveTimeRange]);

  return {
    isAutoMoveEnabled, toggleAutoMove,
    isAutoRematchEnabled, toggleAutoRematch,
    isPremoveEnabled, togglePremove,
    moveTimeRange, setMoveTimeRange,
    premoveTimeRange, setPremoveTimeRange,
  };
}
