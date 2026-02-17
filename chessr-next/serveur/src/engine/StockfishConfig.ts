/**
 * StockfishConfig - Fixed configuration for move analysis
 * Full strength analysis (no ELO limiting, no personality)
 */

export const ANALYSIS_DEPTH = 10;
export const ANALYSIS_MULTIPV = 2;

export interface AnalysisConfigParams {
  depth?: number;
  multiPv?: number;
}

/**
 * Get UCI options for Stockfish analysis mode
 */
export function getAnalysisConfig(params?: AnalysisConfigParams): Record<string, string> {
  const multiPv = params?.multiPv ?? ANALYSIS_MULTIPV;

  return {
    'MultiPV': multiPv.toString(),
    'UCI_ShowWDL': 'true',
    'Threads': '1',
    'Hash': '128',
    // No UCI_LimitStrength - full strength analysis
    // No Personality - Stockfish doesn't support it
  };
}
