/**
 * KomodoConfig - Engine configuration and personality mapping
 */

export type Personality =
  | 'Default'
  | 'Aggressive'
  | 'Defensive'
  | 'Active'
  | 'Positional'
  | 'Endgame'
  | 'Beginner'
  | 'Human';

/**
 * Map personality names to Komodo Dragon UCI personality strings
 */
export const PERSONALITY_MAP: Record<Personality, string> = {
  Default: 'Default',
  Aggressive: 'Aggressive',
  Defensive: 'Defensive',
  Active: 'Active',
  Positional: 'Positional',
  Endgame: 'Endgame',
  Beginner: 'Beginner',
  Human: 'Human',
};

/** Safety cap for search nodes (Komodo self-limits with UCI LimitStrength) */
export const SEARCH_NODES = 1_000_000;

/**
 * Path to Syzygy tablebases (optional)
 * Set via SYZYGY_PATH environment variable
 */
export const SYZYGY_PATH = process.env.SYZYGY_PATH || '';

export interface EngineConfigParams {
  targetElo: number;
  personality: string;
  multiPv: number;
  contempt?: number;
  variety?: number;
  limitStrength?: boolean;
  armageddon?: 'off' | 'white' | 'black';
  puzzleMode?: boolean;
}

/**
 * Get UCI options for standard engine search with MultiPV
 */
export function getEngineConfig({ targetElo, personality, multiPv, contempt, variety, limitStrength, armageddon, puzzleMode }: EngineConfigParams): Record<string, string> {
  const elo = Math.max(400, Math.min(3500, targetElo || 1500));
  const pv = Math.max(1, Math.min(3, multiPv || 1));
  const personalityValue = PERSONALITY_MAP[personality as Personality] || 'Default';
  // Contempt passed directly from client (-100 to 100), undefined = engine default
  const hasContempt = contempt !== undefined && contempt !== null;
  const contemptValue = hasContempt ? Math.max(-100, Math.min(100, contempt)) : undefined;
  // Whether to limit strength (default true for game mode, false for puzzle mode)
  const shouldLimitStrength = limitStrength !== false;
  // Variety (0-10), undefined = engine default (don't set)
  const varietyValue = variety !== undefined && variety !== null ? Math.max(0, Math.min(10, variety)) : undefined;
  // Map armageddon: 'white' -> 'White Must Win', 'black' -> 'Black Must Win', default 'Off'
  const armageddonValue = armageddon === 'white' ? 'White Must Win' : armageddon === 'black' ? 'Black Must Win' : 'Off';

  // Puzzle mode: full strength, no ELO limit
  if (puzzleMode) {
    return {
      'Personality': 'Default',
      'MultiPV': pv.toString(),
      'UCI LimitStrength': 'false',
      'Contempt': '0',
      'Use LMR': 'true',
      'Null Move Pruning': 'true',
      'Threads': '1',
      'Hash': '512',
      ...(SYZYGY_PATH ? { 'SyzygyPath': SYZYGY_PATH } : {}),
    };
  }

  const config: Record<string, string> = {
    'Personality': personalityValue,
    'MultiPV': pv.toString(),
    'UCI LimitStrength': shouldLimitStrength ? 'true' : 'false',
    'UCI Elo': elo.toString(),
    ...(contemptValue !== undefined ? { 'Contempt': contemptValue.toString() } : {}),
    ...(varietyValue !== undefined ? { 'Variety': varietyValue.toString() } : {}),
    'Armageddon': armageddonValue,
    'Use LMR': 'true',
    'Null Move Pruning': 'true',
    'Threads': '1',
    'Hash': '512',
  };

  // Add Syzygy path if configured
  if (SYZYGY_PATH) {
    config['SyzygyPath'] = SYZYGY_PATH;
  }

  return config;
}
