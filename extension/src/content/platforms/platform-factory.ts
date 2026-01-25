import { PlatformAdapter } from './types';
import { ChesscomAdapter } from './chesscom-adapter';
import { LichessAdapter } from './lichess-adapter';

export function createPlatformAdapter(): PlatformAdapter | null {
  const hostname = window.location.hostname;

  if (hostname.includes('chess.com')) {
    return new ChesscomAdapter();
  }

  if (hostname === 'lichess.org') {
    return new LichessAdapter();
  }

  return null;
}
