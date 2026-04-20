import { create } from 'zustand';
import { SERVER_URL } from '../lib/config';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

interface VersionState {
  updateRequired: boolean;
  checking: boolean;
  currentVersion: string;
  minVersion: string;
  checkVersion: () => Promise<void>;
}

export const useVersionStore = create<VersionState>((set) => ({
  updateRequired: false,
  checking: true,
  currentVersion: '',
  minVersion: '',

  checkVersion: async () => {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      const data = await res.json();
      const current = browser.runtime.getManifest().version;
      const min = data.minExtensionVersion;

      if (min && compareVersions(current, min) < 0) {
        set({ updateRequired: true, checking: false, currentVersion: current, minVersion: min });
      } else {
        set({ updateRequired: false, checking: false, currentVersion: current, minVersion: min });
      }
    } catch {
      set({ updateRequired: false, checking: false });
    }
  },
}));
