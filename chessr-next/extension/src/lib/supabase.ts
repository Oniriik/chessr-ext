/**
 * Supabase Client for Chrome Extension
 * Uses chrome.storage.local for session persistence
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Chrome storage adapter for Supabase auth
const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch {
      // Ignore storage errors
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await chrome.storage.local.remove(key);
    } catch {
      // Ignore storage errors
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'chessr-auth',
    storage: chromeStorageAdapter,
    autoRefreshToken: true,
    detectSessionInUrl: false, // Important for Chrome extensions
  },
});
