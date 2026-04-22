/**
 * Per-engine `go` command formatting.
 *
 * Wrapper exists because multiple engines (Dragon, Stockfish, Torch, Maia…)
 * may be served over the same UCI interface later, and some accept
 * non-standard tokens. Today all use the stock UCI `go` syntax.
 */

export type EngineKind = 'dragon' | 'stockfish' | 'torch' | 'maia' | 'patricia';

export type SearchMode = 'nodes' | 'depth' | 'movetime';

export interface SearchOptions {
  mode: SearchMode;
  nodes?: number;
  depth?: number;
  movetime?: number;
}

const CLAMPS = {
  nodes:    { min: 10_000, max: 50_000_000 },
  depth:    { min: 1,      max: 40 },
  movetime: { min: 100,    max: 30_000 },
} as const;

function clamp(v: number, { min, max }: { min: number; max: number }) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function normalizeSearchOptions(raw: any): SearchOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const mode = raw.mode;
  if (mode !== 'nodes' && mode !== 'depth' && mode !== 'movetime') return null;
  const out: SearchOptions = { mode };
  if (mode === 'nodes' && typeof raw.nodes === 'number')
    out.nodes = clamp(raw.nodes, CLAMPS.nodes);
  if (mode === 'depth' && typeof raw.depth === 'number')
    out.depth = clamp(raw.depth, CLAMPS.depth);
  if (mode === 'movetime' && typeof raw.movetime === 'number')
    out.movetime = clamp(raw.movetime, CLAMPS.movetime);
  return out;
}

export function buildGoCommand(
  opts: SearchOptions | null | undefined,
  _engine: EngineKind = 'dragon',
): string {
  // No options → bare `go` (engine's own default behavior).
  if (!opts) return 'go';

  // All current engines share the UCI-standard `go` syntax. Branch per engine
  // here when a future engine needs different tokens.
  switch (opts.mode) {
    case 'nodes':
      return opts.nodes != null ? `go nodes ${opts.nodes}` : 'go';
    case 'depth':
      return opts.depth != null ? `go depth ${opts.depth}` : 'go';
    case 'movetime':
      return opts.movetime != null ? `go movetime ${opts.movetime}` : 'go';
  }
}
