import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as chesscom from '../platforms/chesscom';
import * as lichess from '../lib/lichess';
import { FREE_LIMITS, isPremium } from '../lib/planUtils';
import type { Plan } from '../components/ui/plan-badge';

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

// Ambition labels (maps directly to Komodo contempt -250 to 250)
export const AMBITION_LEVELS = [
  { threshold: -250, label: 'Draw Seeker', description: 'Actively seeks draws at all costs' },
  { threshold: -200, label: 'Fortress', description: 'Builds impenetrable positions' },
  { threshold: -150, label: 'Drawish', description: 'Strongly prefers safe, drawn positions' },
  { threshold: -100, label: 'Solid', description: 'Favors stability and low-risk play' },
  { threshold: -50, label: 'Cautious', description: 'Slightly conservative approach' },
  { threshold: -20, label: 'Steady', description: 'Marginally risk-averse' },
  { threshold: 0, label: 'Balanced', description: 'Objective, neutral play' },
  { threshold: 20, label: 'Confident', description: 'Slightly favors winning chances' },
  { threshold: 50, label: 'Ambitious', description: 'Prefers dynamic, unbalanced positions' },
  { threshold: 80, label: 'Bold', description: 'Takes clear risks to press for a win' },
  { threshold: 120, label: 'Aggressive', description: 'Actively avoids draws' },
  { threshold: 160, label: 'Ruthless', description: 'High risk tolerance, sharp play' },
  { threshold: 200, label: 'All-in', description: 'Extreme win-or-bust mentality' },
  { threshold: 240, label: 'Berserker', description: 'Maximum aggression, no compromises' },
] as const;

export function getAmbitionLabel(value: number): string {
  for (let i = AMBITION_LEVELS.length - 1; i >= 0; i--) {
    if (value >= AMBITION_LEVELS[i].threshold) {
      return AMBITION_LEVELS[i].label;
    }
  }
  return AMBITION_LEVELS[0].label;
}

export function getAmbitionDescription(value: number): string {
  for (let i = AMBITION_LEVELS.length - 1; i >= 0; i--) {
    if (value >= AMBITION_LEVELS[i].threshold) {
      return AMBITION_LEVELS[i].description;
    }
  }
  return AMBITION_LEVELS[0].description;
}

// Armageddon mode (on/off - uses player color from gameStore when enabled)
export type ArmageddonMode = boolean;

interface EngineState {
  // Detected ELOs
  userElo: number;
  opponentElo: number;

  // Auto mode toggle
  targetEloAuto: boolean;
  autoEloBoost: number;

  // Manual value (used when auto is off)
  targetEloManual: number;

  // Ambition (-250 to 250, maps directly to Komodo contempt)
  ambition: number;
  ambitionAuto: boolean;

  // Personality
  personality: Personality;

  // Variety (0-100, maps to Komodo Variety UCI option)
  variety: number;

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
  setAutoEloBoost: (boost: number) => void;
  setTargetEloManual: (elo: number) => void;
  setAmbition: (value: number) => void;
  setAmbitionAuto: (auto: boolean) => void;
  setPersonality: (personality: Personality) => void;
  setVariety: (value: number) => void;
  setArmageddon: (enabled: boolean) => void;
  setDisableLimitStrength: (value: boolean) => void;

  // Auto-detect from DOM
  detectFromDOM: () => void;

  // Enforce plan limits (reset settings that exceed free limits)
  enforcePlanLimits: (plan: Plan) => void;
}

export const useEngineStore = create<EngineState>()(
  persist(
    (set, get) => ({
      // Initial values
      userElo: 1500,
      opponentElo: 1500,
      targetEloAuto: true,
      autoEloBoost: 50,
      targetEloManual: 1650,
      ambition: 0,
      ambitionAuto: true,
      personality: 'Default',
      variety: 5,
      armageddon: false,
      disableLimitStrength: false,

      // Target ELO: auto = base ELO + boost (opponent if detected, otherwise user)
      getTargetElo: () => {
        const { targetEloAuto, autoEloBoost, opponentElo, userElo, targetEloManual } = get();
        if (!targetEloAuto) return targetEloManual;
        const baseElo = opponentElo > 0 ? opponentElo : userElo;
        return baseElo + autoEloBoost;
      },

      // Setters
      setUserElo: (elo) => set({ userElo: elo }),
      setOpponentElo: (elo) => set({ opponentElo: elo }),
      setTargetEloAuto: (auto) => set({ targetEloAuto: auto }),
      setAutoEloBoost: (boost) => set({ autoEloBoost: boost }),
      setTargetEloManual: (elo) => set({ targetEloManual: elo }),
      setAmbition: (value: number) => set({ ambition: value }),
      setAmbitionAuto: (auto) => set({ ambitionAuto: auto }),
      setPersonality: (personality) => set({ personality }),
      setVariety: (value) => set({ variety: value }),
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

      // Enforce plan limits - reset any settings that exceed free limits
      enforcePlanLimits: (plan: Plan) => {
        if (isPremium(plan)) return; // Premium users have no limits

        const state = get();
        const updates: Partial<EngineState> = {};

        // Check target ELO (manual value)
        if (state.targetEloManual > FREE_LIMITS.maxElo) {
          updates.targetEloManual = FREE_LIMITS.maxElo;
        }

        // Force ambition auto for free users
        if (!state.ambitionAuto) {
          updates.ambitionAuto = true;
        }

        // Check personality
        if (!FREE_LIMITS.allowedPersonalities.includes(state.personality as typeof FREE_LIMITS.allowedPersonalities[number])) {
          updates.personality = 'Default';
        }

        // Lock variety to 5 for free users
        if (state.variety !== 5) {
          updates.variety = 5;
        }

        // Check armageddon
        if (state.armageddon) {
          updates.armageddon = false;
        }

        // Apply updates if any
        if (Object.keys(updates).length > 0) {
          set(updates);
        }
      },
    }),
    {
      name: 'chessr-engine',
      partialize: (state) => ({
        targetEloAuto: state.targetEloAuto,
        autoEloBoost: state.autoEloBoost,
        targetEloManual: state.targetEloManual,
        ambition: state.ambition,
        ambitionAuto: state.ambitionAuto,
        personality: state.personality,
        variety: state.variety,
        armageddon: state.armageddon,
        disableLimitStrength: state.disableLimitStrength,
      }),
    }
  )
);
