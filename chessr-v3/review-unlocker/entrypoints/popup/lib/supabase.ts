import { createClient } from '@supabase/supabase-js';

const storageAdapter = {
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
    } catch {}
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await chrome.storage.local.remove(key);
    } catch {}
  },
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      // Distinct storageKey so the unlocker popup doesn't trample the main
      // chessr extension's session if a user has both installed. They can
      // sign in independently; same Supabase project, different sessions.
      storageKey: 'chessr-unlocker-auth',
      storage: storageAdapter,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
