/**
 * Infrastructure: Settings Repository
 * Chrome storage access for settings
 */

import { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { config } from '../../shared/config';

export interface ISettingsRepository {
  get(): Promise<Settings>;
  save(settings: Partial<Settings>): Promise<void>;
  onChange(callback: (settings: Settings) => void): void;
}

export class ChromeSettingsRepository implements ISettingsRepository {
  async get(): Promise<Settings> {
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...result.settings };

    // ALWAYS use the server URL from build config (environment variable)
    // This ensures dev builds connect to localhost and prod builds connect to VPS
    settings.serverUrl = config.stockfishServerUrl;

    return settings;
  }

  async save(partial: Partial<Settings>): Promise<void> {
    const current = await this.get();

    // Remove serverUrl from partial to prevent it from being saved
    // Server URL is always controlled by the build configuration
    const { serverUrl, ...settingsToSave } = partial;

    const updated = { ...current, ...settingsToSave };
    await chrome.storage.sync.set({ settings: updated });
  }

  onChange(callback: (settings: Settings) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.settings) {
        const newSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };

        // ALWAYS use the server URL from build config
        newSettings.serverUrl = config.stockfishServerUrl;

        callback(newSettings);
      }
    });
  }
}

// Singleton instance
export const settingsRepository = new ChromeSettingsRepository();
