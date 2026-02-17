import { Settings } from './types';
import { config } from './config';

// Analysis window: analyze only the last N moves (not the entire game)
// This keeps analysis fast (~0.5s) while the extension accumulates stats over time
export const DEFAULT_LAST_MOVES = 1;

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

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  serverUrl: config.stockfishServerUrl, // Uses environment variable
  userElo: 1500,  // Default user ELO
  targetElo: 1650,  // Default target ELO (userElo + 150)
  autoDetectTargetElo: true,  // Auto-detect enabled by default
  personality: 'Default',
  armageddon: 'off',  // Armageddon mode disabled by default
  riskTaking: 20,  // Cautious by default (0-100 maps to contempt 0-200cp)
  skill: 10,  // Solid by default (1-25 maps to Komodo Skill)
  multiPV: 3,
  showArrows: true,
  showEvalBar: true,
  evalBarMode: 'eval',  // Default to showing evaluation in pawns
  blunderThreshold: 100,
  selectedOpening: '',
  useDifferentArrowColors: true,
  arrowColors: {
    best: '#00c850',    // Green
    second: '#ffc800',  // Yellow
    other: '#0078ff',   // Blue
  },
  singleArrowColor: '#00c850',  // Green
  language: 'auto',  // Auto-detect browser language
  numberOfSuggestions: 3,  // Show all 3 suggestions by default
  disableLimitStrength: false,  // Keep limit strength enabled by default

  // New feedback & analysis options (all enabled by default)
  showSuggestions: true,
  showRollingAccuracy: true,
  showQualityLabels: true,
  showEffectLabels: true,
  showPromotionAsText: true,
};
