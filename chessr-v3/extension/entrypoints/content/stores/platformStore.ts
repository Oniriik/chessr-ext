import { create } from 'zustand';

export type Platform = 'chesscom' | 'lichess' | 'worldchess' | null;

interface PlatformState {
  platform: Platform;
  detect: () => void;
}

function detectPlatform(): Platform {
  const host = window.location.hostname;
  if (host.includes('chess.com')) return 'chesscom';
  if (host.includes('lichess.org')) return 'lichess';
  if (host.includes('worldchess.com')) return 'worldchess';
  return null;
}

export const usePlatformStore = create<PlatformState>((set) => ({
  platform: detectPlatform(),
  detect: () => set({ platform: detectPlatform() }),
}));

/**
 * Premove support per platform.
 *   - chesscom: native API (game.premoves.move) + the executeAutoMove
 *     "play during opponent's turn" fallback both work reliably.
 *   - lichess: chessground supports it via the same executeAutoMove
 *     trick, but inconsistencies have been observed in production —
 *     gated off until we get cleaner verification.
 *   - worldchess: drag-synthesis is best-effort, the wrapper component
 *     manages the queue internally; treated as unsupported until users
 *     report stable behavior.
 *   - unknown / null: no platform → can't premove anyway.
 */
export function platformSupportsPremove(p: Platform): boolean {
  return p === 'chesscom';
}
