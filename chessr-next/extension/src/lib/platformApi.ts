/**
 * Platform API utilities for fetching Chess.com and Lichess profiles
 */

export type Platform = 'chesscom' | 'lichess';

export interface PlatformProfile {
  username: string;
  platform: Platform;
  avatarUrl?: string;
  ratings: {
    bullet?: number;
    blitz?: number;
    rapid?: number;
  };
}

interface ChessComPlayerResponse {
  username: string;
  player_id: number;
  avatar?: string;
  url: string;
}

interface ChessComStatsResponse {
  chess_bullet?: { last: { rating: number } };
  chess_blitz?: { last: { rating: number } };
  chess_rapid?: { last: { rating: number } };
}

interface LichessUserResponse {
  id: string;
  username: string;
  perfs?: {
    bullet?: { rating: number };
    blitz?: { rating: number };
    rapid?: { rating: number };
  };
}

/**
 * Fetch a Chess.com player profile
 */
export async function fetchChessComProfile(username: string): Promise<PlatformProfile | null> {
  try {
    const [profileRes, statsRes] = await Promise.all([
      fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}`),
      fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}/stats`),
    ]);

    if (!profileRes.ok) return null;

    const profile: ChessComPlayerResponse = await profileRes.json();
    const stats: ChessComStatsResponse | null = statsRes.ok ? await statsRes.json() : null;

    return {
      username: profile.username,
      platform: 'chesscom',
      avatarUrl: profile.avatar,
      ratings: {
        bullet: stats?.chess_bullet?.last?.rating,
        blitz: stats?.chess_blitz?.last?.rating,
        rapid: stats?.chess_rapid?.last?.rating,
      },
    };
  } catch (error) {
    console.error('[platformApi] Failed to fetch Chess.com profile:', error);
    return null;
  }
}

/**
 * Fetch a Lichess player profile
 */
export async function fetchLichessProfile(username: string): Promise<PlatformProfile | null> {
  try {
    const res = await fetch(`https://lichess.org/api/user/${username}`);
    if (!res.ok) return null;

    const data: LichessUserResponse = await res.json();

    return {
      username: data.username,
      platform: 'lichess',
      // Lichess doesn't have public avatars in API
      avatarUrl: undefined,
      ratings: {
        bullet: data.perfs?.bullet?.rating,
        blitz: data.perfs?.blitz?.rating,
        rapid: data.perfs?.rapid?.rating,
      },
    };
  } catch (error) {
    console.error('[platformApi] Failed to fetch Lichess profile:', error);
    return null;
  }
}

/**
 * Fetch a platform profile based on platform type
 */
export async function fetchPlatformProfile(
  platform: Platform,
  username: string
): Promise<PlatformProfile | null> {
  if (platform === 'chesscom') {
    return fetchChessComProfile(username);
  } else {
    return fetchLichessProfile(username);
  }
}
