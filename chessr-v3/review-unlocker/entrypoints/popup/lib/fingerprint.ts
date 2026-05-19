/**
 * Browser fingerprint via fingerprintjs (open-source v5).
 *
 * Computed on demand for signup so the serveur can cross-check against
 * `user_fingerprints` and flag multi-account abuse. Cached for the
 * lifetime of the popup — fingerprint is stable per browser profile.
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
