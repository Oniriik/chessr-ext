/**
 * Version checking utilities for extension updates
 */

/**
 * Get current extension version from manifest
 */
export function getCurrentVersion(): string {
  return chrome.runtime.getManifest().version;
}

/**
 * Compare two semantic versions
 * Returns: -1 if a < b, 0 if a = b, 1 if a > b
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
 * Check if current version is below minimum required
 */
export function isUpdateRequired(minVersion: string): boolean {
  return compareVersions(getCurrentVersion(), minVersion) < 0;
}

export interface VersionCheckResult {
  updateRequired: boolean;
  currentVersion: string;
  minVersion?: string;
  downloadUrl?: string;
}

/**
 * Check version against server
 * Converts WebSocket URL to HTTP for the version endpoint
 */
export async function checkVersion(serverUrl: string): Promise<VersionCheckResult> {
  const currentVersion = getCurrentVersion();

  try {
    // Convert ws:// or wss:// to http:// or https://
    const httpUrl = serverUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    const response = await fetch(`${httpUrl}/version`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { updateRequired: false, currentVersion };
    }

    const data = await response.json();

    if (isUpdateRequired(data.minVersion)) {
      return {
        updateRequired: true,
        currentVersion,
        minVersion: data.minVersion,
        downloadUrl: data.downloadUrl,
      };
    }

    return { updateRequired: false, currentVersion };
  } catch {
    // Network error - allow to proceed (don't block users if server is down)
    return { updateRequired: false, currentVersion };
  }
}
