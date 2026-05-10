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
  /** Server-provided URL the user is sent to when they need to update.
   *  Empty string when /health is unreachable; the UpdateRequired
   *  component falls back to a hardcoded URL in that case. */
  downloadUrl: string;
  checkVersion: () => Promise<void>;
}

export const useVersionStore = create<VersionState>((set) => ({
  updateRequired: false,
  checking: true,
  currentVersion: '',
  minVersion: '',
  downloadUrl: '',

  checkVersion: async () => {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      const data = await res.json();
      const current = browser.runtime.getManifest().version;
      const min = data.minExtensionVersion;
      const downloadUrl = typeof data.downloadUrl === 'string' ? data.downloadUrl : '';

      if (min && compareVersions(current, min) < 0) {
        set({ updateRequired: true, checking: false, currentVersion: current, minVersion: min, downloadUrl });
      } else {
        set({ updateRequired: false, checking: false, currentVersion: current, minVersion: min, downloadUrl });
      }
    } catch {
      set({ updateRequired: false, checking: false });
    }
  },
}));
