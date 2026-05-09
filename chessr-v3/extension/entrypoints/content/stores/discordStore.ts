import { create } from 'zustand';
import { SERVER_URL } from '../lib/config';

interface DiscordState {
  linked: boolean;
  username: string | null;
  avatar: string | null;
  loading: boolean;
  /** Whether the linked Discord account is also a member of the
   *  configured guild. `null` = unknown / not yet checked / network
   *  blip. Drives the "join the community" widget CTA. */
  inGuild: boolean | null;

  fetchStatus: (userId: string) => Promise<void>;
  fetchMembership: (userId: string) => Promise<void>;
  initLink: (userId: string) => void;
  unlink: (userId: string) => Promise<void>;
}

export const useDiscordStore = create<DiscordState>((set) => ({
  linked: false,
  username: null,
  avatar: null,
  inGuild: null,
  // Default false — fetchStatus is only called when a user is logged
  // in (App.tsx watches user.id), so leaving loading=true by default
  // would lock the Settings card on "..." for any session that never
  // signs in.
  loading: false,

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

  fetchMembership: async (userId) => {
    try {
      const res = await fetch(`${SERVER_URL}/discord/membership-status?userId=${userId}`);
      const data = await res.json();
      // Treat `null` (unknown / network blip) as such — don't downgrade
      // to false because that would mis-trigger "join us" prompts on
      // people who actually are in the server.
      set({ inGuild: typeof data.inGuild === 'boolean' ? data.inGuild : null });
    } catch {
      set({ inGuild: null });
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
