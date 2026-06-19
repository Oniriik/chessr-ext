import { Hono } from 'hono';
import { getDb } from '../db.js';

export const gameRouter = new Hono();

type DbOpening = {
  id: number;
  eco: string; name: string; pgn: string; uci: string; epd: string;
  white_wr: number | null; draw_wr: number | null; black_wr: number | null; total: number | null;
};

type Alternative = {
  uci: string;
  eco: string;
  name: string;
  total: number | null;
  white_wr: number | null;
  draw_wr: number | null;
  black_wr: number | null;
};

function fmtOpening(o: DbOpening) {
  return {
    eco: o.eco,
    name: o.name,
    pgn: o.pgn,
    uci: o.uci,
    winRate: o.total
      ? { white: o.white_wr, draw: o.draw_wr, black: o.black_wr, total: o.total }
      : null,
  };
}

function nextMoves(parentUci: string): Alternative[] {
  const db = getDb();
  const prefix = parentUci ? parentUci + ' ' : '';
  const escaped = prefix.replace(/[%_\\]/g, '\\$&');

  const rows = db.prepare(`
    SELECT eco, name, uci, total, white_wr, draw_wr, black_wr
    FROM openings
    WHERE uci LIKE ? ESCAPE '\\'
    ORDER BY total DESC, eco ASC
    LIMIT 20
  `).all(escaped + '%') as Pick<DbOpening, 'eco' | 'name' | 'uci' | 'total' | 'white_wr' | 'draw_wr' | 'black_wr'>[];

  const seen = new Set<string>();
  const alts: Alternative[] = [];
  for (const r of rows) {
    const rest = r.uci.slice(prefix.length);
    const move = rest.split(' ')[0];
    if (!move || seen.has(move)) continue;
    seen.add(move);
    alts.push({ uci: move, eco: r.eco, name: r.name, total: r.total, white_wr: r.white_wr, draw_wr: r.draw_wr, black_wr: r.black_wr });
  }
  return alts;
}

/**
 * GET /game?moves=e2e4+e7e5+g1f3+b8c6
 *
 * Given the UCI move sequence of a game, returns:
 * - opening: the deepest known opening still matching the game (always present while in-book, kept after deviation)
 * - inBook: whether the current position is still in the opening book
 * - nextMoves: alternative continuations if still in book (null if deviated)
 * - deviation: if out of book, the move that deviated + what theory proposed instead
 */
gameRouter.get('/', (c) => {
  const movesStr = c.req.query('moves') ?? '';
  const moves = movesStr.trim() ? movesStr.trim().split(/[\s+]+/) : [];

  const db = getDb();

  // Walk back from the full game to find the deepest exact book match.
  // Opening UCIs are space-separated so we join with ' '.
  let lastBookOpening: DbOpening | null = null;
  let lastBookDepth = 0;

  for (let i = moves.length; i >= 0; i--) {
    const uci = moves.slice(0, i).join(' ');
    const row = db.prepare(`SELECT * FROM openings WHERE uci = ? LIMIT 1`).get(uci) as DbOpening | undefined;
    if (row) {
      lastBookOpening = row;
      lastBookDepth = i;
      break;
    }
  }

  const inBook = lastBookDepth === moves.length;
  const deviationMove = inBook ? null : (moves[lastBookDepth] ?? null);

  const alts = nextMoves(lastBookOpening?.uci ?? '');

  return c.json({
    opening: lastBookOpening ? fmtOpening(lastBookOpening) : null,
    inBook,
    nextMoves: inBook ? alts : null,
    deviation: inBook ? null : {
      move: deviationMove,
      alternatives: alts,
    },
  });
});
