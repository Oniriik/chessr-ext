/**
 * engineStore — Engine configuration for suggestions
 */

import { create } from 'zustand';
import type { Plan } from './authStore';

export type Personality = 'Default' | 'Aggressive' | 'Defensive' | 'Active' | 'Positional' | 'Endgame' | 'Beginner' | 'Human';
export type SearchMode = 'nodes' | 'depth' | 'movetime';

export interface EngineCapabilities {
  hasPersonality: boolean;
  hasUciElo: boolean;
  hasDynamism: boolean;
  hasKingSafety: boolean;
  hasVariety: boolean;
}

const CAPABILITIES_PERMISSIVE: EngineCapabilities = {
  hasPersonality: true, hasUciElo: true, hasDynamism: true, hasKingSafety: true, hasVariety: true,
};

export const PERSONALITY_INFO: Record<Personality, { label: string; desc: string }> = {
  Default:    { label: 'Engine',     desc: 'Plays like an engine with minimal errors.' },
  Aggressive: { label: 'Aggressive', desc: 'Attacks relentlessly, prefers active pieces.' },
  Defensive:  { label: 'Defensive',  desc: 'Emphasizes king safety and solid position.' },
  Active:     { label: 'Active',     desc: 'Tends toward open positions and well-placed pieces.' },
  Positional: { label: 'Positional', desc: 'Solid play, maneuvering, more closed positions.' },
  Endgame:    { label: 'Endgame',    desc: 'Prefers playing through to win by promoting a pawn.' },
  Beginner:   { label: 'Beginner',   desc: "Doesn't understand fundamentals, checks and captures." },
  Human:      { label: 'Human',      desc: 'Optimized to play like strong human players.' },
};

/**
 * Dynamism (Komodo native range 0..200; default 100).
 * Higher = more willing to sacrifice material for initiative / dynamic play.
 */
export const DYNAMISM_LABELS: { value: number; label: string; desc: string }[] = [
  { value: 0,   label: 'Passive',     desc: 'Prefers simple, material-solid play' },
  { value: 60,  label: 'Cautious',    desc: 'Avoids speculative sacrifices' },
  { value: 100, label: 'Balanced',    desc: 'Default balance between material and activity' },
  { value: 140, label: 'Dynamic',     desc: 'Willing to give up material for pressure' },
  { value: 200, label: 'Sharp',       desc: 'Constantly seeks imbalance and sacrifices' },
];

/**
 * King Safety (Komodo native range 0..200; default 100).
 * Higher = more conservative king; engine keeps defenders close. Lower =
 * bold king placement, more willing to expose the king for an attack.
 */
export const KING_SAFETY_LABELS: { value: number; label: string; desc: string }[] = [
  { value: 0,   label: 'Reckless',    desc: 'Throws the king into the fight' },
  { value: 60,  label: 'Bold',        desc: 'Opens up the kingside for attack' },
  { value: 100, label: 'Balanced',    desc: 'Default king-safety weighting' },
  { value: 140, label: 'Careful',     desc: 'Keeps extra defenders around the king' },
  { value: 200, label: 'Fortified',   desc: 'Absolute priority on king shelter' },
];

const FREE_PERSONALITIES: Personality[] = ['Default', 'Aggressive'];
const ALL_PERSONALITIES: Personality[] = ['Default', 'Aggressive', 'Defensive', 'Active', 'Positional', 'Endgame', 'Beginner', 'Human'];

function closestLabel(
  labels: { value: number; label: string; desc: string }[],
  value: number,
): { label: string; desc: string } {
  let closest = labels[0];
  for (const l of labels) {
    if (Math.abs(l.value - value) < Math.abs(closest.value - value)) closest = l;
  }
  return closest;
}

export const getDynamismLabel = (v: number) => closestLabel(DYNAMISM_LABELS, v);
export const getKingSafetyLabel = (v: number) => closestLabel(KING_SAFETY_LABELS, v);

interface EngineState {
  targetEloAuto: boolean;
  targetEloManual: number;
  autoEloBoost: number;
  userElo: number;
  opponentElo: number;

  personality: Personality;
  dynamism: number;
  dynamismAuto: boolean;
  kingSafety: number;
  kingSafetyAuto: boolean;
  variety: number;

  limitStrength: boolean;
  searchMode: SearchMode;
  searchNodes: number;
  searchDepth: number;
  searchMovetime: number;

  capabilities: EngineCapabilities;
  setCapabilities: (c: EngineCapabilities) => void;

  setTargetEloAuto: (v: boolean) => void;
  setTargetEloManual: (v: number) => void;
  setAutoEloBoost: (v: number) => void;
  setUserElo: (v: number) => void;
  setOpponentElo: (v: number) => void;
  setPersonality: (v: Personality) => void;
  setDynamism: (v: number) => void;
  setDynamismAuto: (v: boolean) => void;
  setKingSafety: (v: number) => void;
  setKingSafetyAuto: (v: boolean) => void;
  setVariety: (v: number) => void;
  setLimitStrength: (v: boolean) => void;
  setSearchMode: (v: SearchMode) => void;
  setSearchNodes: (v: number) => void;
  setSearchDepth: (v: number) => void;
  setSearchMovetime: (v: number) => void;
  resetToDefaults: () => void;

  getEffectiveElo: () => number;
  getPersonalities: (plan: Plan) => Personality[];
}

const ENGINE_DEFAULTS = {
  targetEloAuto: true,
  targetEloManual: 1650,
  autoEloBoost: 80,
  userElo: 1500,
  opponentElo: 0,
  personality: 'Default' as Personality,
  dynamism: 100,
  dynamismAuto: true,
  kingSafety: 100,
  kingSafetyAuto: true,
  variety: 0,
  limitStrength: true,
  searchMode: 'nodes' as SearchMode,
  searchNodes: 1_000_000,
  searchDepth: 20,
  searchMovetime: 2000,
};

function isPremium(plan: Plan): boolean {
  return plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';
}

export const useEngineStore = create<EngineState>()((set, get) => ({
  ...ENGINE_DEFAULTS,
  capabilities: CAPABILITIES_PERMISSIVE,
  setCapabilities: (c) => set({ capabilities: c }),

  setTargetEloAuto: (v) => set({ targetEloAuto: v }),
  setTargetEloManual: (v) => set({ targetEloManual: Math.max(400, Math.min(3500, v)) }),
  setAutoEloBoost: (v) => set({ autoEloBoost: Math.max(0, Math.min(500, v)) }),
  setUserElo: (v) => set({ userElo: v }),
  setOpponentElo: (v) => set({ opponentElo: v }),
  setPersonality: (v) => set({ personality: v }),
  setDynamism: (v) => set({ dynamism: Math.max(0, Math.min(200, v)) }),
  setDynamismAuto: (v) => set({ dynamismAuto: v }),
  setKingSafety: (v) => set({ kingSafety: Math.max(0, Math.min(200, v)) }),
  setKingSafetyAuto: (v) => set({ kingSafetyAuto: v }),
  setVariety: (v) => set({ variety: Math.max(0, Math.min(10, v)) }),
  setLimitStrength: (v) => set({ limitStrength: v }),
  setSearchMode: (v) => set({ searchMode: v }),
  setSearchNodes: (v) => set({ searchNodes: Math.max(100_000, Math.min(5_000_000, v)) }),
  setSearchDepth: (v) => set({ searchDepth: Math.max(1, Math.min(30, v)) }),
  setSearchMovetime: (v) => set({ searchMovetime: Math.max(500, Math.min(5000, v)) }),
  resetToDefaults: () => set({ ...ENGINE_DEFAULTS }),

  getEffectiveElo: () => {
    const { targetEloAuto, targetEloManual, autoEloBoost, opponentElo, userElo } = get();
    if (!targetEloAuto) return targetEloManual;
    const base = opponentElo > 0 ? opponentElo : userElo;
    return base + autoEloBoost;
  },

  getPersonalities: (plan) => isPremium(plan) ? ALL_PERSONALITIES : FREE_PERSONALITIES,
}));
