/** Extract the chess.com game id from a URL, or null if the URL isn't a
 *  chess.com game / analysis page we can review.
 *
 *  Covers:
 *    /game/live/<id>, /game/daily/<id>, /game/<id>
 *    /analysis/game/live/<id>, /analysis/game/daily/<id>
 *
 *  Excludes bot / computer games (no review available). */
export function extractGameIdFromUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/\.?chess\.com$/.test(url.hostname)) return null;
  const path = url.pathname;
  if (path.includes('/computer')) return null;
  const match = path.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/);
  return match ? match[1] : null;
}

export async function getActiveTabGameId(): Promise<{ gameId: string | null; url: string | null }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? null;
    return { gameId: extractGameIdFromUrl(url ?? undefined), url };
  } catch {
    return { gameId: null, url: null };
  }
}
