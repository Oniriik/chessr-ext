import { PlatformAdapter } from './types';
import { ChesscomAdapter } from './chesscom-adapter';

export function createPlatformAdapter(): PlatformAdapter | null {
  const hostname = window.location.hostname;

  if (hostname.includes('chess.com')) {
    return new ChesscomAdapter();
  }

  // Lichess adapter will be added here later
  // if (hostname === 'lichess.org') {
  //   return new LichessAdapter();
  // }

  return null;
}
