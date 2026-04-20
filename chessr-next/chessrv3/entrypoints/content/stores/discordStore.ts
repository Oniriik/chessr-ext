import { create } from 'zustand';
import { SERVER_URL } from '../lib/config';

interface DiscordState {
  linked: boolean;
  username: string | null;
  avatar: string | null;
  loading: boolean;

  fetchStatus: (userId: string) => Promise<void>;
  initLink: (userId: string) => void;
  unlink: (userId: string) => Promise<void>;
}

export const useDiscordStore = create<DiscordState>((set) => ({
  linked: false,
  username: null,
  avatar: null,
  loading: true,

  fetchStatus: async (userId) => {
    set({ loading: true });
    try {
      const res = await fetch(`${SERVER_URL}/discord/status?userId=${userId}`);
      const data = await res.json();
      set({ linked: data.linked, username: data.username, avatar: data.avatar, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  initLink: (userId) => {
    fetch(`${SERVER_URL}/discord/link?userId=${userId}&returnUrl=${encodeURIComponent(window.location.href)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.url) window.location.href = data.url;
      })
      .catch(() => {});
  },

  unlink: async (userId) => {
    try {
      await fetch(`${SERVER_URL}/discord/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      set({ linked: false, username: null, avatar: null });
    } catch {}
  },
}));
