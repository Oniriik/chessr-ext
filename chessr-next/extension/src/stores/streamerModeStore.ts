import { create } from 'zustand';

interface StreamerModeState {
  isStreamerTabOpen: boolean;
  setStreamerTabOpen: (open: boolean) => void;
}

export const useStreamerModeStore = create<StreamerModeState>((set) => ({
  isStreamerTabOpen: false,
  setStreamerTabOpen: (open) => set({ isStreamerTabOpen: open }),
}));
