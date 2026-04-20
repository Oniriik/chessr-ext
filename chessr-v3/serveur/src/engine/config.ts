export type Personality = 'Default' | 'Aggressive' | 'Defensive' | 'Active' | 'Positional' | 'Endgame' | 'Beginner' | 'Human';

const SYZYGY_PATH = process.env.SYZYGY_PATH || '';

export interface EngineParams {
  targetElo: number;
  personality: string;
  multiPv: number;
  limitStrength?: boolean;
  contempt?: number;
  variety?: number;
}

export function getEngineConfig(params: EngineParams): Record<string, string> {
  const elo = Math.max(400, Math.min(3500, params.targetElo));
  const pv = Math.max(1, Math.min(3, params.multiPv));
  const personality = params.personality || 'Default';
  const limit = params.limitStrength !== false;

  const config: Record<string, string> = {
    Personality: personality,
    MultiPV: pv.toString(),
    'UCI LimitStrength': limit ? 'true' : 'false',
    'UCI Elo': elo.toString(),
    'Use LMR': 'true',
    'Null Move Pruning': 'true',
    Threads: '1',
    Hash: '512',
  };

  if (params.contempt !== undefined) {
    config.Contempt = Math.max(-100, Math.min(100, params.contempt)).toString();
  }
  if (params.variety !== undefined) {
    config.Variety = Math.max(0, Math.min(10, params.variety)).toString();
  }
  if (SYZYGY_PATH) {
    config.SyzygyPath = SYZYGY_PATH;
  }

  return config;
}
