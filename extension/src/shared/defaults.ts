import { Settings } from './types';
import { config } from './config';

// Analysis window: analyze only the last N moves (not the entire game)
// This keeps analysis fast (~0.5s) while the extension accumulates stats over time
export const DEFAULT_LAST_MOVES = 1;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  serverUrl: config.stockfishServerUrl, // Uses environment variable
  userElo: 1500,  // Default user ELO
  targetElo: 1650,  // Default target ELO (userElo + 150)
  opponentElo: 1500,  // Default opponent ELO (same as player)
  autoDetectTargetElo: true,  // Auto-detect enabled by default
  autoDetectOpponentElo: true,  // Auto-detect enabled by default
  personality: 'Default',
  searchMode: 'time',
  depth: 18,
  moveTime: 1000,  // 1 second default
  multiPV: 3,
  showArrows: true,
  showEvalBar: true,
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
