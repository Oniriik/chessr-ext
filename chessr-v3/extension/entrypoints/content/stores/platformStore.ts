import { create } from 'zustand';

export type Platform = 'chesscom' | 'lichess' | null;

interface PlatformState {
  platform: Platform;
  detect: () => void;
}

function detectPlatform(): Platform {
  const host = window.location.hostname;
  if (host.includes('chess.com')) return 'chesscom';
  if (host.includes('lichess.org')) return 'lichess';
  return null;
}

export const usePlatformStore = create<PlatformState>((set) => ({
  platform: detectPlatform(),
  detect: () => set({ platform: detectPlatform() }),
}));
