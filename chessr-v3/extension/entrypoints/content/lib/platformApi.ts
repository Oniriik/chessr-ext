export type Platform = 'chesscom' | 'lichess' | 'worldchess';

export interface PlatformProfile {
  /** Stable platform-specific identifier — used to match `linked_accounts`
   *  rows on subsequent visits. Slug-style on chess.com / lichess (the
   *  username); numeric profile id on worldchess (display names there are
   *  editable so they can't be the linking key). */
  username: string;
  platform: Platform;
  /** Pretty name for the link-screen card. Defaults to `username` when
   *  the platform's stable identifier IS the displayed name (chess.com /
   *  lichess). On worldchess this holds the editable `full_name`. */
  displayName?: string;
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

/** Worldchess profile lookup. The "username" we receive here is the
 *  profile id (numeric, from /profile/<id>) — getWorldchessUsername
 *  falls back to it when no display name is in the DOM, and we also
 *  store ids on the linked-accounts side for stability across renames.
 *  Endpoint: api.worldchess.com/api/online/players/<id>/ — public,
 *  no auth required. Returns full_name, avatar URLs, and bullet /
 *  blitz / rapid ratings under the worldchess_<mode> keys. */
export async function fetchWorldchessProfile(profileId: string): Promise<PlatformProfile | null> {
  // The lookup expects a numeric id. If we received a display name
  // we can't resolve it to an id without scraping (no public search
  // API), so just bail to the stub.
  if (!/^\d+$/.test(profileId)) {
    return { username: profileId, platform: 'worldchess', ratings: {} };
  }
  try {
    const res = await fetch(`https://api.worldchess.com/api/online/players/${profileId}/`);
    if (!res.ok) return null;

    const data = await res.json();
    const norm = (n: unknown): number | undefined => {
      const v = typeof n === 'number' ? n : NaN;
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    return {
      // Stable numeric id is the linking key — full_name is editable.
      username: profileId,
      platform: 'worldchess',
      displayName: data.profile?.full_name,
      avatarUrl: data.profile?.avatar?.small ?? data.profile?.avatar?.medium ?? data.profile?.avatar?.full,
      ratings: {
        bullet: norm(data.worldchess_bullet),
        blitz: norm(data.worldchess_blitz),
        rapid: norm(data.worldchess_rapid),
      },
    };
  } catch {
    return null;
  }
}

export function fetchPlatformProfile(platform: Platform, username: string): Promise<PlatformProfile | null> {
  if (platform === 'chesscom') return fetchChessComProfile(username);
  if (platform === 'lichess') return fetchLichessProfile(username);
  if (platform === 'worldchess') return fetchWorldchessProfile(username);
  return Promise.resolve({ username, platform, ratings: {} });
}
