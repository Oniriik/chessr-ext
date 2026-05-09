/**
 * Browser fingerprint via fingerprintjs (open-source v5).
 *
 * Computed on demand for signup / signin flows so we can cross-check
 * against `user_fingerprints` server-side and flag multi-account abuse.
 *
 * Cached for the lifetime of the content script — the fingerprint is
 * stable per browser profile, no need to recompute on every call.
 */

import FingerprintJS from '@fingerprintjs/fingerprintjs';

let cached: Promise<string | null> | null = null;

export function getFingerprint(): Promise<string | null> {
  if (cached) return cached;
  cached = (async () => {
    try {
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      return result.visitorId;
    } catch (err) {
      console.warn('[fingerprint] failed to compute:', err);
      return null;
    }
  })();
  return cached;
}
