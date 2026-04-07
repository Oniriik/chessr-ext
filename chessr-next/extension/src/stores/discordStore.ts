/**
 * Discord Store (Zustand)
 * Manages Discord linking state
 */

import { create } from 'zustand';

interface ActiveGiveaway {
  name: string;
  prizes: string | null;
  ends_at: string;
}

interface DiscordState {
  isLinked: boolean;
  discordUsername: string | null;
  discordAvatar: string | null;
  freetrialUsed: boolean;
  inGuild: boolean;
  isLinking: boolean;
  activeGiveaway: ActiveGiveaway | null;
  giveawayDismissed: boolean;

  setLinked: (linked: boolean, username: string | null, avatar: string | null) => void;
  setFreetrialUsed: (used: boolean) => void;
  setInGuild: (inGuild: boolean) => void;
  setLinking: (linking: boolean) => void;
  setActiveGiveaway: (giveaway: ActiveGiveaway | null) => void;
  dismissGiveaway: () => void;
  reset: () => void;
}

export const useDiscordStore = create<DiscordState>((set) => ({
  isLinked: false,
  discordUsername: null,
  discordAvatar: null,
  freetrialUsed: false,
  inGuild: false,
  isLinking: false,
  activeGiveaway: null,
  giveawayDismissed: false,

  setLinked: (linked, username, avatar) =>
    set({ isLinked: linked, discordUsername: username, discordAvatar: avatar, isLinking: false }),
  setFreetrialUsed: (used) => set({ freetrialUsed: used }),
  setInGuild: (inGuild) => set({ inGuild }),
  setLinking: (linking) => set({ isLinking: linking }),
  setActiveGiveaway: (giveaway) => set({ activeGiveaway: giveaway }),
  dismissGiveaway: () => set({ giveawayDismissed: true }),
  reset: () =>
    set({ isLinked: false, discordUsername: null, discordAvatar: null, inGuild: false, isLinking: false, activeGiveaway: null, giveawayDismissed: false }),
}));
