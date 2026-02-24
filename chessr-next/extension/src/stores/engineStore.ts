import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as chesscom from '../platforms/chesscom';
import * as lichess from '../lib/lichess';

/**
 * Detect current platform from hostname
 */
function detectPlatform(): 'chesscom' | 'lichess' {
  const hostname = window.location.hostname;
  if (hostname.includes('lichess.org')) return 'lichess';
  return 'chesscom';
}

/**
 * Get platform-specific detection functions
 */
function getPlatformModule() {
  return detectPlatform() === 'lichess' ? lichess : chesscom;
}

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
    label: 'Engine',
    description: 'Plays like an engine with minimal errors.',
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
    description: 'Optimized to play like strong human players.',
  },
};

// Risk Taking labels (maps to Komodo contempt 0-200)
export const RISK_LEVELS = [
  { threshold: 0, label: 'Passive' },
  { threshold: 20, label: 'Cautious' },
  { threshold: 40, label: 'Moderate' },
  { threshold: 60, label: 'Bold' },
  { threshold: 80, label: 'Aggressive' },
  { threshold: 100, label: 'Overconfident' },
] as const;

export function getRiskLabel(value: number): string {
  for (let i = RISK_LEVELS.length - 1; i >= 0; i--) {
    if (value >= RISK_LEVELS[i].threshold) {
      return RISK_LEVELS[i].label;
    }
  }
  return RISK_LEVELS[0].label;
}

// Skill levels (Komodo Skill 1-25)
export const SKILL_LEVELS = [
  { threshold: 1, label: 'Casual' },
  { threshold: 6, label: 'Solid' },
  { threshold: 11, label: 'Sharp' },
  { threshold: 16, label: 'Precise' },
  { threshold: 21, label: 'Ruthless' },
] as const;

export function getSkillLabel(value: number): string {
  for (let i = SKILL_LEVELS.length - 1; i >= 0; i--) {
    if (value >= SKILL_LEVELS[i].threshold) {
      return SKILL_LEVELS[i].label;
    }
  }
  return SKILL_LEVELS[0].label;
}

// Armageddon mode (on/off - uses player color from gameStore when enabled)
export type ArmageddonMode = boolean;

interface EngineState {
  // Detected ELOs
  userElo: number;
  opponentElo: number;

  // Auto mode toggle
  targetEloAuto: boolean;

  // Manual value (used when auto is off)
  targetEloManual: number;

  // Risk taking (0-100)
  riskTaking: number;

  // Skill level (1-25)
  skill: number;

  // Personality
  personality: Personality;

  // Armageddon mode (enabled = must win with player's color)
  armageddon: boolean;

  // Disable limit strength (unlock full power at 3500 ELO)
  disableLimitStrength: boolean;

  // Computed getter
  getTargetElo: () => number;

  // Actions
  setUserElo: (elo: number) => void;
  setOpponentElo: (elo: number) => void;
  setTargetEloAuto: (auto: boolean) => void;
  setTargetEloManual: (elo: number) => void;
  setRiskTaking: (value: number) => void;
  setSkill: (value: number) => void;
  setPersonality: (personality: Personality) => void;
  setArmageddon: (enabled: boolean) => void;
  setDisableLimitStrength: (value: boolean) => void;

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
      targetEloManual: 1650,
      riskTaking: 0,
      skill: 10,
      personality: 'Default',
      armageddon: false,
      disableLimitStrength: false,

      // Target ELO: auto = base ELO + 150 (opponent if detected, otherwise user)
      getTargetElo: () => {
        const { targetEloAuto, opponentElo, userElo, targetEloManual } = get();
        if (!targetEloAuto) return targetEloManual;
        // Use opponent ELO + 150 if detected, otherwise user ELO + 150
        const baseElo = opponentElo > 0 ? opponentElo : userElo;
        return baseElo + 150;
      },

      // Setters
      setUserElo: (elo) => set({ userElo: elo }),
      setOpponentElo: (elo) => set({ opponentElo: elo }),
      setTargetEloAuto: (auto) => set({ targetEloAuto: auto }),
      setTargetEloManual: (elo) => set({ targetEloManual: elo }),
      setRiskTaking: (value: number) => set({ riskTaking: value }),
      setSkill: (value: number) => set({ skill: value }),
      setPersonality: (personality) => set({ personality }),
      setArmageddon: (enabled) => set({ armageddon: enabled }),
      setDisableLimitStrength: (value) => set({ disableLimitStrength: value }),

      // Detect ratings from DOM (platform-aware)
      detectFromDOM: () => {
        const platformModule = getPlatformModule();
        const ratings = platformModule.detectRatings();

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
        targetEloManual: state.targetEloManual,
        riskTaking: state.riskTaking,
        skill: state.skill,
        personality: state.personality,
        armageddon: state.armageddon,
        disableLimitStrength: state.disableLimitStrength,
      }),
    }
  )
);
