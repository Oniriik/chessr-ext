/**
 * Discord Store (Zustand)
 * Manages Discord linking state
 */

import { create } from 'zustand';

interface DiscordState {
  isLinked: boolean;
  discordUsername: string | null;
  discordAvatar: string | null;
  freetrialUsed: boolean;
  inGuild: boolean;
  isLinking: boolean;

  setLinked: (linked: boolean, username: string | null, avatar: string | null) => void;
  setFreetrialUsed: (used: boolean) => void;
  setInGuild: (inGuild: boolean) => void;
  setLinking: (linking: boolean) => void;
  reset: () => void;
}

export const useDiscordStore = create<DiscordState>((set) => ({
  isLinked: false,
  discordUsername: null,
  discordAvatar: null,
  freetrialUsed: false,
  inGuild: false,
  isLinking: false,

  setLinked: (linked, username, avatar) =>
    set({ isLinked: linked, discordUsername: username, discordAvatar: avatar, isLinking: false }),
  setFreetrialUsed: (used) => set({ freetrialUsed: used }),
  setInGuild: (inGuild) => set({ inGuild }),
  setLinking: (linking) => set({ isLinking: linking }),
  reset: () =>
    set({ isLinked: false, discordUsername: null, discordAvatar: null, inGuild: false, isLinking: false }),
}));
