export interface GameMeta {
  white: string | null;
  black: string | null;
  whiteRating: string | null;
  blackRating: string | null;
  result: string | null;
  timeControl: string | null;
  moveCount: number | null;
  termination: string | null;
}

/** Fetch game headers from chess.com's public callback API.
 *  Same endpoint chessr-v3's serveur uses; works without auth for finished
 *  games. Returns null on any error so callers can fall back to placeholders. */
export async function fetchChesscomGameMeta(gameId: string): Promise<GameMeta | null> {
  try {
    const res = await fetch(
      `https://www.chess.com/callback/live/game/${gameId}?all=true`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const h = data.game?.pgnHeaders || {};
    return {
      white: h.White ?? null,
      black: h.Black ?? null,
      whiteRating: h.WhiteElo ?? null,
      blackRating: h.BlackElo ?? null,
      result: h.Result ?? null,
      timeControl: h.TimeControl ?? null,
      moveCount: typeof data.game?.plyCount === 'number' ? Math.ceil(data.game.plyCount / 2) : null,
      termination: h.Termination ?? null,
    };
  } catch {
    return null;
  }
}

const avatarCache = new Map<string, string | null>();

/** Fetch a chess.com player's avatar URL. Cached in-memory for the popup
 *  lifetime — chess.com avatars are stable, the popup is short-lived. */
export async function fetchChesscomAvatar(username: string | null | undefined): Promise<string | null> {
  if (!username) return null;
  if (avatarCache.has(username)) return avatarCache.get(username)!;
  try {
    const res = await fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}`);
    if (!res.ok) {
      avatarCache.set(username, null);
      return null;
    }
    const data = await res.json();
    const av: string | null = data?.avatar || null;
    avatarCache.set(username, av);
    return av;
  } catch {
    avatarCache.set(username, null);
    return null;
  }
}
