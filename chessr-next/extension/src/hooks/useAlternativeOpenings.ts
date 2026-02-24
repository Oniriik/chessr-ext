/**
 * useAlternativeOpenings - Fetches compatible openings when player deviates
 * Returns openings that match the moves already played, sorted by win rate
 * For free users: returns count only (alternatives array is empty)
 */

import { useState, useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';
import { findCompatibleOpenings, type OpeningWithStats } from '../lib/openingsDatabase';
import { usePlanLimits } from '../lib/planUtils';

export function useAlternativeOpenings(hasDeviated: boolean) {
  const moveHistory = useGameStore((state) => state.moveHistory);
  const playerColor = useGameStore((state) => state.playerColor);
  const { canSeeAlternativeOpenings } = usePlanLimits();
  const [alternatives, setAlternatives] = useState<OpeningWithStats[]>([]);
  const [alternativesCount, setAlternativesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Only fetch alternatives when deviated
    if (!hasDeviated || !playerColor || moveHistory.length === 0) {
      setAlternatives([]);
      setAlternativesCount(0);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    findCompatibleOpenings(moveHistory, playerColor, 3)
      .then((results) => {
        if (!cancelled) {
          // Always set the count (for free users to show "X alternatives found")
          setAlternativesCount(results.length);
          // Only set full data for premium users
          setAlternatives(canSeeAlternativeOpenings ? results : []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlternatives([]);
          setAlternativesCount(0);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasDeviated, moveHistory, playerColor, canSeeAlternativeOpenings]);

  return { alternatives, alternativesCount, isLoading };
}
