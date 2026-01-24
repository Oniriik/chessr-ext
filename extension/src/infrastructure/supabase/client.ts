/**
 * Infrastructure: Supabase Client
 * Authentication and database access
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ratngdlkcvyfdmidtenx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhdG5nZGxrY3Z5ZmRtaWR0ZW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwODE0OTMsImV4cCI6MjA4NDY1NzQ5M30.ZYXOVkGgIrdymoRFOs5MHP_03UPOt6Mu00ijYL12Bv4';

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
