/**
 * Maintenance Store (Zustand)
 * Tracks scheduled maintenance window from server
 */

import { create } from 'zustand';

interface MaintenanceState {
  /** Scheduled maintenance start Unix timestamp (seconds), null = none */
  scheduledAt: number | null;
  /** Scheduled maintenance end Unix timestamp (seconds), null = none */
  endAt: number | null;
  /** Update the scheduled maintenance (from server auth_success) */
  setSchedule: (start: number | null, end: number | null) => void;
}

export const useMaintenanceStore = create<MaintenanceState>()((set) => ({
  scheduledAt: null,
  endAt: null,
  setSchedule: (start, end) => {
    set({
      scheduledAt: start && start > 0 ? start : null,
      endAt: end && end > 0 ? end : null,
    });
  },
}));
