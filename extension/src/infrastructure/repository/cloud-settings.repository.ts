/**
 * Infrastructure: Cloud Settings Repository
 * Supabase storage for settings synchronization
 */

import { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { config } from '../../shared/config';
import { supabase } from '../supabase/client';

export interface ICloudSettingsRepository {
  get(userId: string): Promise<Settings | null>;
  save(userId: string, settings: Partial<Settings>): Promise<void>;
  sync(userId: string, localSettings: Settings): Promise<Settings>;
}

export class SupabaseSettingsRepository implements ICloudSettingsRepository {
  /**
   * Get settings from Supabase for a user
   */
  async get(userId: string): Promise<Settings | null> {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('settings')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No row found - user has no saved settings yet
          return null;
        }
        throw error;
      }

      const settings = { ...DEFAULT_SETTINGS, ...data.settings };
      // ALWAYS use the server URL from build config
      settings.serverUrl = config.stockfishServerUrl;
      return settings;
    } catch {
      return null;
    }
  }

  /**
   * Save settings to Supabase (upsert)
   */
  async save(userId: string, settings: Partial<Settings>): Promise<void> {
    try {
      // Remove serverUrl from settings to prevent it from being saved
      const { serverUrl, ...settingsToSave } = settings;

      // First, get current settings
      const current = await this.get(userId);
      const merged = current ? { ...current, ...settingsToSave } : { ...DEFAULT_SETTINGS, ...settingsToSave };

      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          settings: merged,
        }, {
          onConflict: 'user_id',
        });

      if (error) throw error;
    } catch {
      // Ignore cloud save errors
    }
  }

  /**
   * Sync local settings with cloud settings
   * Strategy: Cloud wins if exists, otherwise use local
   */
  async sync(userId: string, localSettings: Settings): Promise<Settings> {
    try {
      const cloudSettings = await this.get(userId);

      if (cloudSettings) {
        // ALWAYS use the server URL from build config
        cloudSettings.serverUrl = config.stockfishServerUrl;
        return cloudSettings;
      }

      // No cloud settings - save local to cloud and return local
      await this.save(userId, localSettings);
      // ALWAYS use the server URL from build config
      localSettings.serverUrl = config.stockfishServerUrl;
      return localSettings;
    } catch {
      // ALWAYS use the server URL from build config
      localSettings.serverUrl = config.stockfishServerUrl;
      return localSettings;
    }
  }
}

// Singleton instance
export const cloudSettingsRepository = new SupabaseSettingsRepository();
