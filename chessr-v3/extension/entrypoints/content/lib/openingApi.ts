const OPENS_API = 'https://opens.chessr.io';

export interface OpeningEntry {
  eco: string;
  name: string;
  uci: string;
  winRate: { white: number | null; draw: number | null; black: number | null; total: number } | null;
}

export interface NextMove {
  uci: string;
  eco: string;
  name: string;
  winRate: OpeningEntry['winRate'];
}

export interface GameApiResult {
  opening: OpeningEntry | null;
  inBook: boolean;
  deviationDepth: number | null;
  nextMoves: NextMove[] | null;
  deviation: {
    move: string;
    alternatives: NextMove[];
  } | null;
}

export async function queryGame(moves: string[]): Promise<GameApiResult | null> {
  try {
    const url = `${OPENS_API}/game?moves=${moves.join('+')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return (await res.json()) as GameApiResult;
  } catch {
    return null;
  }
}

/** ECO codes of the most-played openings — the browse list shown while the
 *  search box is empty. Order = display order. Roots resolved server-side
 *  (shortest line per ECO). */
const POPULAR_ECOS = ['C50', 'B20', 'C60', 'A48', 'C00', 'B10', 'D06', 'C25', 'C45', 'C30', 'B01', 'C42', 'A40', 'A10'];

export async function fetchPopularOpenings(): Promise<OpeningEntry[]> {
  try {
    const res = await fetch(`${OPENS_API}/openings?ecos=${POPULAR_ECOS.join(',')}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { openings: OpeningEntry[] };
    return data.openings ?? [];
  } catch {
    return [];
  }
}

export async function searchOpenings(q: string, limit = 40): Promise<OpeningEntry[]> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (q) params.set('q', q);
    const res = await fetch(`${OPENS_API}/openings?${params}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { openings: OpeningEntry[] };
    return data.openings ?? [];
  } catch {
    return [];
  }
}
