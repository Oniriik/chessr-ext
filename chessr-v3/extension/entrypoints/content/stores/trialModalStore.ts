import { create } from 'zustand';

/**
 * TrialModalStore — open/close state for the free-trial modal.
 *
 * `source` records which premium wall opened the modal ('panel-header',
 * 'review-quota', 'engine-lock', 'opening-tab', 'automove-tab', …) and is
 * attached to the funnel tracking events so we learn which walls convert.
 */
interface TrialModalState {
  isOpen: boolean;
  source: string | null;
  open: (source: string) => void;
  close: () => void;
}

export const useTrialModalStore = create<TrialModalState>((set) => ({
  isOpen: false,
  source: null,
  open: (source) => set({ isOpen: true, source }),
  close: () => set({ isOpen: false }),
}));
