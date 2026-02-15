import { Platform, PlatformContext } from './types';
import { chesscom } from './chesscom';
import { lichess } from './lichess';

const platforms: Platform[] = [chesscom, lichess];

export function detectPlatform(url: URL): Platform | null {
  return platforms.find(p => p.hostname.test(url.hostname)) ?? null;
}

export function getPlatformContext(url: URL): PlatformContext | null {
  const platform = detectPlatform(url);
  if (!platform) return null;

  return {
    platform,
    route: platform.detectRoute(url),
    url,
  };
}

export { chesscom, lichess };
export * from './types';
