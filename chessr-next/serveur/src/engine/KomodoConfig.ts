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
 * Search nodes limit
 * With UCI_LimitStrength, this gives consistent analysis quality
 */
export const SEARCH_NODES = 700000; // 700k nodes (~0.35-1.4s)

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
}

/**
 * Get UCI options for standard engine search with MultiPV
 */
export function getEngineConfig({ targetElo, personality, multiPv, contempt }: EngineConfigParams): Record<string, string> {
  const elo = Math.max(800, Math.min(3200, targetElo || 1500));
  const pv = Math.max(1, Math.min(3, multiPv || 1));
  const personalityValue = PERSONALITY_MAP[personality as Personality] || 'Default';
  // Map winIntent (0-100) to Komodo contempt (0-200)
  // 0 = neutral, 50 = ~GM level (100cp), 100 = amateur level (200cp)
  const contemptValue = Math.max(0, Math.min(250, (contempt ?? 0) * 2));

  const config: Record<string, string> = {
    'Personality': personalityValue,
    'MultiPV': pv.toString(),
    'UCI_ShowWDL': 'true',
    'UCI_LimitStrength': 'true',
    'UCI_Elo': elo.toString(),
    'Contempt': contemptValue.toString(),
    'Threads': '1',
    'Hash': '512',
  };

  // Add Syzygy path if configured
  if (SYZYGY_PATH) {
    config['SyzygyPath'] = SYZYGY_PATH;
  }

  return config;
}
