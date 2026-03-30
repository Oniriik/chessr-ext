import { create } from 'zustand';

interface BetaState {
  flags: string[];
  setFlags: (flags: string[]) => void;
  hasBeta: (code: string) => boolean;
  reset: () => void;
}

export const useBetaStore = create<BetaState>((set, get) => ({
  flags: [],

  setFlags: (flags: string[]) => set({ flags }),

  hasBeta: (code: string) => get().flags.includes(code),

  reset: () => set({ flags: [] }),
}));
