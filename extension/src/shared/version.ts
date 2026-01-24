/**
 * Get current extension version from manifest
 */
export function getCurrentVersion(): string {
  return chrome.runtime.getManifest().version;
}

/**
 * Compare semantic versions
 * Returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
}

/**
 * Check if update is required based on minimum version
 */
export function isUpdateRequired(minVersion: string): boolean {
  return compareVersions(getCurrentVersion(), minVersion) < 0;
}
