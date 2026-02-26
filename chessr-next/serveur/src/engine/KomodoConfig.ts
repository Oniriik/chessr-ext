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

/**
 * Compute search nodes based on target ELO.
 * Linear interpolation: 50k nodes at ELO 400, 1M nodes at ELO 3500.
 * Lower ELO = fewer nodes = faster + less precise (more natural).
 */
export function computeNodesForElo(elo: number): number {
  const minElo = 400;
  const maxElo = 3500;
  const minNodes = 50_000;
  const maxNodes = 1_000_000;
  const clamped = Math.max(minElo, Math.min(maxElo, elo));
  return Math.round(minNodes + ((clamped - minElo) / (maxElo - minElo)) * (maxNodes - minNodes));
}

/** Max nodes for puzzle mode (full strength) */
export const PUZZLE_NODES = 1_000_000;

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
  limitStrength?: boolean;
  armageddon?: 'off' | 'white' | 'black';
  puzzleMode?: boolean;
}

/**
 * Get UCI options for standard engine search with MultiPV
 */
export function getEngineConfig({ targetElo, personality, multiPv, contempt, limitStrength, armageddon, puzzleMode }: EngineConfigParams): Record<string, string> {
  const elo = Math.max(400, Math.min(3500, targetElo || 1500));
  const pv = Math.max(1, Math.min(3, multiPv || 1));
  const personalityValue = PERSONALITY_MAP[personality as Personality] || 'Default';
  // Map winIntent (0-100) to Komodo contempt (0-200)
  // 0 = neutral, 50 = ~GM level (100cp), 100 = amateur level (200cp)
  const contemptValue = Math.max(0, Math.min(250, (contempt ?? 0) * 2));
  // Whether to limit strength (default true for game mode, false for puzzle mode)
  const shouldLimitStrength = limitStrength !== false;
  // Map armageddon: 'white' -> 'White Must Win', 'black' -> 'Black Must Win', default 'Off'
  const armageddonValue = armageddon === 'white' ? 'White Must Win' : armageddon === 'black' ? 'Black Must Win' : 'Off';

  // Puzzle mode: full strength, no ELO limit
  if (puzzleMode) {
    return {
      'Personality': 'Default',
      'MultiPV': pv.toString(),
      'UCI LimitStrength': 'false',
      'Contempt': '0',
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
    'Contempt': contemptValue.toString(),
    'Armageddon': armageddonValue,
    'Threads': '1',
    'Hash': '512',
  };

  // Add Syzygy path if configured
  if (SYZYGY_PATH) {
    config['SyzygyPath'] = SYZYGY_PATH;
  }

  return config;
}
