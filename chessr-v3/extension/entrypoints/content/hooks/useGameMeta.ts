import { useState, useEffect } from 'react';

export interface GameMeta {
  whiteName: string | null;
  blackName: string | null;
  whiteRating: string | null;
  blackRating: string | null;
  result: string | null;
  timeControl: string | null;
  moveCount: number | null;
  termination: string | null;
}

const EMPTY: GameMeta = {
  whiteName: null, blackName: null,
  whiteRating: null, blackRating: null,
  result: null, timeControl: null,
  moveCount: null, termination: null,
};

const cache = new Map<string, GameMeta>();

export function useGameMeta(gameId: string): GameMeta {
  const [meta, setMeta] = useState<GameMeta>(cache.get(gameId) || EMPTY);

  useEffect(() => {
    if (cache.has(gameId)) { setMeta(cache.get(gameId)!); return; }

    let cancelled = false;

    fetch(`https://www.chess.com/callback/live/game/${gameId}?all=true`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const h = data.game?.pgnHeaders || {};
        const plyCount = data.game?.plyCount || 0;

        const result: GameMeta = {
          whiteName: h.White || null,
          blackName: h.Black || null,
          whiteRating: h.WhiteElo || null,
          blackRating: h.BlackElo || null,
          result: h.Result || null,
          timeControl: h.TimeControl || null,
          moveCount: plyCount > 0 ? Math.ceil(plyCount / 2) : null,
          termination: h.Termination || null,
        };

        cache.set(gameId, result);
        setMeta(result);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [gameId]);

  return meta;
}
