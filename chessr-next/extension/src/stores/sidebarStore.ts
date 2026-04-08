import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isOpen: boolean;
  showSettings: boolean;
  settingsTab: string | null;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setShowSettings: (show: boolean) => void;
  openSettingsTab: (tab: string) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isOpen: false,
      showSettings: false,
      settingsTab: null,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setShowSettings: (show) => set({ showSettings: show, settingsTab: show ? null : null }),
      openSettingsTab: (tab) => set({ showSettings: true, settingsTab: tab }),
    }),
    {
      name: 'chessr-sidebar',
      partialize: (state) => ({ isOpen: state.isOpen }),
    }
  )
);
