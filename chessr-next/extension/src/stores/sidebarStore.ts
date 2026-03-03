import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isOpen: boolean;
  showSettings: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setShowSettings: (show: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isOpen: false,
      showSettings: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setShowSettings: (show) => set({ showSettings: show }),
    }),
    {
      name: 'chessr-sidebar',
      partialize: (state) => ({ isOpen: state.isOpen }),
    }
  )
);
