export type Personality =
  | 'Default' | 'Aggressive' | 'Defensive' | 'Active'
  | 'Positional' | 'Endgame' | 'Beginner' | 'Human';

export interface EngineParams {
  targetElo: number;
  personality: string;
  multiPv: number;
  limitStrength: boolean;
  contempt?: number;
  variety?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function eloToSkillLevel(elo: number): number {
  const clamped = clamp(elo, 400, 3500);
  return Math.round(((clamped - 400) / (3500 - 400)) * 100);
}

/**
 * Build `setoption` key/value pairs filtered by the engine's advertised options.
 *
 * `supported` must be populated from the `option name …` lines returned by the
 * engine's `uci` response — we honour Dragon's spelling verbatim (space vs
 * underscore: Komodo and Stockfish disagree on `UCI Elo` vs `UCI_Elo`).
 */
export function buildEngineSetOptions(
  params: EngineParams,
  supported: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const elo = clamp(params.targetElo, 400, 3500);
  const pv = clamp(params.multiPv, 1, 3);
  const limit = params.limitStrength;

  if (supported.has('MultiPV')) out.MultiPV = String(pv);

  if (supported.has('Personality')) {
    out.Personality = params.personality || 'Default';
  }

  const limitKey = supported.has('UCI LimitStrength')
    ? 'UCI LimitStrength'
    : supported.has('UCI_LimitStrength') ? 'UCI_LimitStrength' : null;
  const eloKey = supported.has('UCI Elo')
    ? 'UCI Elo'
    : supported.has('UCI_Elo') ? 'UCI_Elo' : null;

  if (limitKey && eloKey) {
    out[limitKey] = limit ? 'true' : 'false';
    out[eloKey] = String(elo);
  } else if (supported.has('Skill Level')) {
    out['Skill Level'] = String(eloToSkillLevel(elo));
  }

  if (params.contempt !== undefined && supported.has('Contempt')) {
    out.Contempt = String(clamp(params.contempt, -100, 100));
  }
  if (params.variety !== undefined && supported.has('Variety')) {
    out.Variety = String(clamp(params.variety, 0, 10));
  }

  return out;
}
