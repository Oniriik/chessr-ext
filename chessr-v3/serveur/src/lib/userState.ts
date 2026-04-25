/**
 * Per-user runtime state — what engine mode each connected user is running.
 *
 * Populated from `*_log_start` messages (see ws.ts). The extension tags each
 * telemetry line with `source=wasm|server` and `engine=komodo|maia2|stockfish`,
 * so we just parse the extra string and remember the most recent value.
 *
 * Read by /admin/users/connected so the dashboard can show, per player:
 *   - which suggestion engine they're using (Komodo vs Maia 2)
 *   - whether suggestions are running in-browser (WASM) or as server fallback
 *   - same for analysis (always Stockfish, but WASM vs server)
 */

export interface EngineUsage {
  source: 'wasm' | 'server';
  engine: string | null;
  ts: number;
}

interface UserState {
  lastSuggestion?: EngineUsage;
  lastAnalysis?: EngineUsage;
  lastEval?: EngineUsage;
}

const state = new Map<string, UserState>();

function parseExtra(extra: string | undefined): { source: 'wasm' | 'server' | null; engine: string | null } {
  if (!extra || typeof extra !== 'string') return { source: null, engine: null };
  const sourceM = extra.match(/source=(wasm|server)\b/);
  const engineM = extra.match(/engine=([a-z0-9_-]+)/i);
  return {
    source: sourceM ? (sourceM[1] as 'wasm' | 'server') : null,
    engine: engineM ? engineM[1] : null,
  };
}

function record(userId: string, kind: 'lastSuggestion' | 'lastAnalysis' | 'lastEval', extra?: string): void {
  const { source, engine } = parseExtra(extra);
  if (!source) return;
  const prev = state.get(userId) || {};
  prev[kind] = { source, engine, ts: Date.now() };
  state.set(userId, prev);
}

export function recordSuggestion(userId: string, extra?: string): void {
  record(userId, 'lastSuggestion', extra);
}

export function recordAnalysis(userId: string, extra?: string): void {
  record(userId, 'lastAnalysis', extra);
}

export function recordEval(userId: string, extra?: string): void {
  record(userId, 'lastEval', extra);
}

export function getUserState(userId: string): UserState | null {
  return state.get(userId) || null;
}

export function dropUser(userId: string): void {
  state.delete(userId);
}
