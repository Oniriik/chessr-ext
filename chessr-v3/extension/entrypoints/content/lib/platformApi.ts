export type Platform = 'chesscom' | 'lichess' | 'worldchess';

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

export async function fetchChessComProfile(username: string): Promise<PlatformProfile | null> {
  try {
    const [profileRes, statsRes] = await Promise.all([
      fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}`),
      fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}/stats`),
    ]);
    if (!profileRes.ok) return null;

    const profile = await profileRes.json();
    const stats = statsRes.ok ? await statsRes.json() : null;

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
  } catch {
    return null;
  }
}

export async function fetchLichessProfile(username: string): Promise<PlatformProfile | null> {
  try {
    const res = await fetch(`https://lichess.org/api/user/${username}`);
    if (!res.ok) return null;

    const data = await res.json();
    return {
      username: data.username,
      platform: 'lichess',
      ratings: {
        bullet: data.perfs?.bullet?.rating,
        blitz: data.perfs?.blitz?.rating,
        rapid: data.perfs?.rapid?.rating,
      },
    };
  } catch {
    return null;
  }
}

export function fetchPlatformProfile(platform: Platform, username: string): Promise<PlatformProfile | null> {
  if (platform === 'chesscom') return fetchChessComProfile(username);
  if (platform === 'lichess') return fetchLichessProfile(username);
  return Promise.resolve({ username, platform: 'worldchess', ratings: {} });
}
