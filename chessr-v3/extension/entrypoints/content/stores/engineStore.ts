/**
 * engineStore — Engine configuration for suggestions
 */

import { create } from 'zustand';
import type { Plan } from './authStore';

export type Personality = 'Default' | 'Aggressive' | 'Defensive' | 'Active' | 'Positional' | 'Endgame' | 'Beginner' | 'Human';
export type SearchMode = 'nodes' | 'depth' | 'movetime';

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

export const AMBITION_LABELS: { value: number; label: string; desc: string }[] = [
  { value: -100, label: 'Draw Seeker', desc: 'Actively seeks draws at all costs' },
  { value: -70,  label: 'Fortress',    desc: 'Builds impenetrable positions' },
  { value: -40,  label: 'Solid',       desc: 'Favors stability and low-risk play' },
  { value: -15,  label: 'Cautious',    desc: 'Slightly conservative approach' },
  { value: 0,    label: 'Balanced',    desc: 'Objective, neutral play' },
  { value: 15,   label: 'Confident',   desc: 'Slightly favors winning chances' },
  { value: 40,   label: 'Ambitious',   desc: 'Prefers dynamic, unbalanced positions' },
  { value: 70,   label: 'Aggressive',  desc: 'Actively avoids draws' },
  { value: 90,   label: 'Ruthless',    desc: 'Maximum aggression, no compromises' },
];

const FREE_PERSONALITIES: Personality[] = ['Default', 'Aggressive'];
const ALL_PERSONALITIES: Personality[] = ['Default', 'Aggressive', 'Defensive', 'Active', 'Positional', 'Endgame', 'Beginner', 'Human'];

export function getAmbitionLabel(value: number): { label: string; desc: string } {
  let closest = AMBITION_LABELS[0];
  for (const l of AMBITION_LABELS) {
    if (Math.abs(l.value - value) < Math.abs(closest.value - value)) closest = l;
  }
  return closest;
}

interface EngineState {
  targetEloAuto: boolean;
  targetEloManual: number;
  autoEloBoost: number;
  userElo: number;
  opponentElo: number;

  personality: Personality;
  ambitionAuto: boolean;
  ambition: number;
  variety: number;

  limitStrength: boolean;
  searchMode: SearchMode;
  searchNodes: number;
  searchDepth: number;
  searchMovetime: number;

  setTargetEloAuto: (v: boolean) => void;
  setTargetEloManual: (v: number) => void;
  setAutoEloBoost: (v: number) => void;
  setUserElo: (v: number) => void;
  setOpponentElo: (v: number) => void;
  setPersonality: (v: Personality) => void;
  setAmbitionAuto: (v: boolean) => void;
  setAmbition: (v: number) => void;
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
  ambitionAuto: true,
  ambition: 0,
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

  setTargetEloAuto: (v) => set({ targetEloAuto: v }),
  setTargetEloManual: (v) => set({ targetEloManual: Math.max(400, Math.min(3500, v)) }),
  setAutoEloBoost: (v) => set({ autoEloBoost: Math.max(0, Math.min(500, v)) }),
  setUserElo: (v) => set({ userElo: v }),
  setOpponentElo: (v) => set({ opponentElo: v }),
  setPersonality: (v) => set({ personality: v }),
  setAmbitionAuto: (v) => set({ ambitionAuto: v }),
  setAmbition: (v) => set({ ambition: Math.max(-100, Math.min(100, v)) }),
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
