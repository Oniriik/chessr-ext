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

// Risk Taking labels (maps to Komodo contempt 0-200)
export const RISK_LEVELS = [
  { threshold: 0, label: 'Safe' },          // 0cp - accept draws
  { threshold: 20, label: 'Cautious' },     // 40cp - vs Super GM
  { threshold: 40, label: 'Moderate' },     // 80cp - vs GM
  { threshold: 60, label: 'Bold' },         // 120cp - vs IM
  { threshold: 80, label: 'Aggressive' },   // 160cp - vs Master
  { threshold: 100, label: 'Reckless' },    // 200cp - vs Amateur
] as const;

export function getRiskLabel(value: number): string {
  for (let i = RISK_LEVELS.length - 1; i >= 0; i--) {
    if (value >= RISK_LEVELS[i].threshold) {
      return RISK_LEVELS[i].label;
    }
  }
  return RISK_LEVELS[0].label;
}

interface EngineState {
  // Detected user ELO
  userElo: number;

  // Auto mode toggle
  targetEloAuto: boolean;

  // Manual value (used when auto is off)
  targetEloManual: number;

  // Risk taking (0-100)
  riskTaking: number;

  // Personality
  personality: Personality;

  // Computed getter
  getTargetElo: () => number;

  // Actions
  setUserElo: (elo: number) => void;
  setTargetEloAuto: (auto: boolean) => void;
  setTargetEloManual: (elo: number) => void;
  setRiskTaking: (value: number) => void;
  setPersonality: (personality: Personality) => void;

  // Auto-detect from DOM
  detectFromDOM: () => void;
}

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
      // Initial values
      userElo: 1500,
      targetEloAuto: true,
      targetEloManual: 1650,
      riskTaking: 0,
      personality: 'Default',

      // Target ELO: auto = userElo + 150, manual = slider value
      getTargetElo: () => {
        const { targetEloAuto, userElo, targetEloManual } = get();
        return targetEloAuto ? userElo + 150 : targetEloManual;
      },

      // Setters
      setUserElo: (elo) => set({ userElo: elo }),
      setTargetEloAuto: (auto) => set({ targetEloAuto: auto }),
      setTargetEloManual: (elo) => set({ targetEloManual: elo }),
      setRiskTaking: (value: number) => set({ riskTaking: value }),
      setPersonality: (personality) => set({ personality }),

      // Detect ratings from Chess.com DOM
      detectFromDOM: () => {
        const ratings = detectRatings();

        if (ratings.playerRating) {
          set({ userElo: ratings.playerRating });
        }
      },
    }),
    {
      name: 'chessr-engine',
      partialize: (state) => ({
        targetEloAuto: state.targetEloAuto,
        targetEloManual: state.targetEloManual,
        riskTaking: state.riskTaking,
        personality: state.personality,
      }),
    }
  )
);
