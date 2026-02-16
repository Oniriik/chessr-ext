import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { detectRatings } from '../platforms/chesscom';

// Komodo Dragon Personalities
export type Personality =
  | 'Default'
  | 'Aggressive'
  | 'Defensive'
  | 'Active'
  | 'Positional'
  | 'Endgame'
  | 'Beginner'
  | 'Human';

export const PERSONALITIES: Personality[] = [
  'Default',
  'Aggressive',
  'Defensive',
  'Active',
  'Positional',
  'Endgame',
  'Beginner',
  'Human',
];

export const PERSONALITY_INFO: Record<Personality, { label: string; description: string }> = {
  Default: {
    label: 'Default',
    description: 'Strongest personality with full control over Contempt setting.',
  },
  Aggressive: {
    label: 'Aggressive',
    description: 'Attacks relentlessly, prefers active pieces, biased toward Queen play.',
  },
  Defensive: {
    label: 'Defensive',
    description: 'Emphasizes king safety and solid position above all.',
  },
  Active: {
    label: 'Active',
    description: 'Tends toward open positions and well-placed pieces.',
  },
  Positional: {
    label: 'Positional',
    description: 'Solid play, maneuvering, more closed positions.',
  },
  Endgame: {
    label: 'Endgame',
    description: 'Prefers playing through to win by promoting a pawn.',
  },
  Beginner: {
    label: 'Beginner',
    description: "Doesn't understand fundamentals, looks to check and capture.",
  },
  Human: {
    label: 'Human',
    description: 'Mimics human-like play with occasional inaccuracies.',
  },
};

interface EngineState {
  // Detected values
  userElo: number;
  opponentElo: number;

  // Auto mode toggles
  targetEloAuto: boolean;
  opponentEloAuto: boolean;

  // Manual values (used when auto is off)
  targetEloManual: number;
  opponentEloManual: number;

  // Personality
  personality: Personality;

  // Computed getters
  getTargetElo: () => number;
  getOpponentElo: () => number;

  // Actions
  setUserElo: (elo: number) => void;
  setOpponentElo: (elo: number) => void;
  setTargetEloAuto: (auto: boolean) => void;
  setOpponentEloAuto: (auto: boolean) => void;
  setTargetEloManual: (elo: number) => void;
  setOpponentEloManual: (elo: number) => void;
  setPersonality: (personality: Personality) => void;

  // Auto-detect from DOM
  detectFromDOM: () => void;
}

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
      // Initial values
      userElo: 1500,
      opponentElo: 1500,
      targetEloAuto: true,
      opponentEloAuto: true,
      targetEloManual: 1650,
      opponentEloManual: 1500,
      personality: 'Default',

      // Target ELO: auto = userElo + 150, manual = slider value
      getTargetElo: () => {
        const { targetEloAuto, userElo, targetEloManual } = get();
        return targetEloAuto ? userElo + 150 : targetEloManual;
      },

      // Opponent ELO: auto = detected, manual = slider value
      getOpponentElo: () => {
        const { opponentEloAuto, opponentElo, opponentEloManual } = get();
        return opponentEloAuto ? opponentElo : opponentEloManual;
      },

      // Setters
      setUserElo: (elo) => set({ userElo: elo }),
      setOpponentElo: (elo) => set({ opponentElo: elo }),
      setTargetEloAuto: (auto) => set({ targetEloAuto: auto }),
      setOpponentEloAuto: (auto) => set({ opponentEloAuto: auto }),
      setTargetEloManual: (elo) => set({ targetEloManual: elo }),
      setOpponentEloManual: (elo) => set({ opponentEloManual: elo }),
      setPersonality: (personality) => set({ personality }),

      // Detect ratings from Chess.com DOM
      detectFromDOM: () => {
        const ratings = detectRatings();

        if (ratings.playerRating) {
          set({ userElo: ratings.playerRating });
        }
        if (ratings.opponentRating) {
          set({ opponentElo: ratings.opponentRating });
        }
      },
    }),
    {
      name: 'chessr-engine',
      partialize: (state) => ({
        targetEloAuto: state.targetEloAuto,
        opponentEloAuto: state.opponentEloAuto,
        targetEloManual: state.targetEloManual,
        opponentEloManual: state.opponentEloManual,
        personality: state.personality,
      }),
    }
  )
);
