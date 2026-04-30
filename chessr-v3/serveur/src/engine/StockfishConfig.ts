/**
 * StockfishConfig — UCI-option builders for Stockfish on the server.
 *
 * Two modes:
 *   - getAnalysisConfig: full-strength move analysis (no ELO limit), used
 *     by the analysis queue for game-review classifications.
 *   - getSuggestionConfig: live suggestion path with optional skill
 *     limiting via UCI_LimitStrength + UCI_Elo. Mirrors the ELO-aware
 *     Komodo suggestion mode, but Stockfish has no personality knobs so
 *     the config is much smaller.
 */

export const ANALYSIS_DEPTH = 18;
export const ANALYSIS_MULTIPV = 1;

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
    'Hash': '1024',
    // No UCI_LimitStrength - full strength analysis
    // No Personality - Stockfish doesn't support it
  };
}

export interface SuggestionConfigParams {
  targetElo: number;
  multiPv: number;
  limitStrength?: boolean;
  puzzleMode?: boolean;
}

/** Stockfish suggestion-mode config. Skill limiting via UCI_LimitStrength
 *  + UCI_Elo (Stockfish's UCI_Elo accepts 1320..3190). When limitStrength
 *  is false (or in puzzle mode), runs at full strength. */
export function getSuggestionConfig(params: SuggestionConfigParams): Record<string, string> {
  const { targetElo, multiPv, limitStrength, puzzleMode } = params;
  const pvCount = Math.max(1, Math.min(3, multiPv));

  // Puzzle mode: full strength regardless of stored ELO.
  if (puzzleMode || limitStrength === false) {
    return {
      'MultiPV': pvCount.toString(),
      'UCI_ShowWDL': 'true',
      'Threads': '1',
      'Hash': '512',
    };
  }

  // Stockfish's UCI_Elo bounds — clamp into the supported window.
  const clampedElo = Math.max(1320, Math.min(3190, targetElo));

  return {
    'MultiPV': pvCount.toString(),
    'UCI_ShowWDL': 'true',
    'UCI_LimitStrength': 'true',
    'UCI_Elo': clampedElo.toString(),
    'Threads': '1',
    'Hash': '512',
  };
}
