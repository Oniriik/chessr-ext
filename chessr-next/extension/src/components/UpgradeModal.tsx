/**
 * UpgradeModal — now simply opens the billing page in a new tab.
 * The billing page handles plan selection and Paddle checkout.
 */

import { create } from 'zustand';
import { openBillingPage } from '../lib/checkoutClient';

interface UpgradeModalStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useUpgradeModal = create<UpgradeModalStore>((set) => ({
  isOpen: false,
  open: () => {
    openBillingPage();
    // Don't set isOpen — nothing to render
  },
  close: () => set({ isOpen: false }),
}));

// No-op component (kept for compatibility with SidebarContent mount)
export function UpgradeModal() {
  return null;
}
