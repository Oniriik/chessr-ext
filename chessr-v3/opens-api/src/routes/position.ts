import { Hono } from 'hono';
import { getDb } from '../db.js';

export const positionRouter = new Hono();

function epdFromFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

type DbOpening = {
  id: number;
  eco: string; name: string; pgn: string; uci: string; epd: string;
  white_wr: number | null; draw_wr: number | null; black_wr: number | null; total: number | null;
};

type Alternative = {
  uci: string;       // next move UCI (e.g. "g1f3")
  eco: string;
  name: string;
  total: number | null;
  white_wr: number | null;
  draw_wr: number | null;
  black_wr: number | null;
};

// Find the next-move alternatives from our local DB by prefix-matching UCI.
function localAlternatives(parentUci: string): Alternative[] {
  const db = getDb();
  const prefix = parentUci ? parentUci + ' ' : '';

  // Get all openings whose UCI starts with this prefix (direct children only).
  // "Direct children" = prefix + exactly one move (no deeper children).
  const rows = db.prepare(`
    SELECT eco, name, uci, total, white_wr, draw_wr, black_wr
    FROM openings
    WHERE uci LIKE ? ESCAPE '\\'
    ORDER BY total DESC, eco ASC
    LIMIT 20
  `).all(prefix.replace(/[%_\\]/g, '\\$&') + '%') as Pick<DbOpening, 'eco' | 'name' | 'uci' | 'total' | 'white_wr' | 'draw_wr' | 'black_wr'>[];

  // Extract the next move token and deduplicate by move.
  const seen = new Set<string>();
  const alts: Alternative[] = [];
  for (const r of rows) {
    const rest = r.uci.slice(prefix.length); // e.g. "g1f3 d7d5 ..."
    const nextMove = rest.split(' ')[0];     // e.g. "g1f3"
    if (!nextMove || seen.has(nextMove)) continue;
    seen.add(nextMove);
    alts.push({ uci: nextMove, eco: r.eco, name: r.name, total: r.total, white_wr: r.white_wr, draw_wr: r.draw_wr, black_wr: r.black_wr });
  }
  return alts;
}

// GET /position?fen=<FEN>
// Returns: which opening this position is in (if any) + alternative next moves from local book.
positionRouter.get('/', (c) => {
  const fen = c.req.query('fen');
  if (!fen) return c.json({ error: 'fen param required' }, 400);

  const db  = getDb();
  const epd = epdFromFen(fen);

  const opening = db.prepare(`SELECT * FROM openings WHERE epd = ? LIMIT 1`).get(epd) as DbOpening | undefined;

  const alternatives = localAlternatives(opening?.uci ?? '');

  return c.json({
    opening: opening
      ? {
          eco: opening.eco,
          name: opening.name,
          pgn: opening.pgn,
          uci: opening.uci,
          winRate: opening.total
            ? { white: opening.white_wr, draw: opening.draw_wr, black: opening.black_wr, total: opening.total }
            : null,
        }
      : null,
    alternatives,
  });
});
