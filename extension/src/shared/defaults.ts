import { Settings } from './types';
import { config } from './config';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  serverUrl: config.stockfishServerUrl, // Uses environment variable
  targetElo: 1500,
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
  allowBrilliant: false,           // Disabled by default
  showAlwaysBestMoveFirst: false,  // Disabled by default
};
