import { Hono } from 'hono';
import { getDb } from '../db.js';

export const openingsRouter = new Hono();

type Opening = {
  eco: string;
  name: string;
  pgn: string;
  uci: string;
  epd: string;
  white_wins: number | null;
  draws: number | null;
  black_wins: number | null;
  total: number | null;
  white_wr: number | null;
  draw_wr: number | null;
  black_wr: number | null;
};

function fmt(o: Opening) {
  return {
    eco: o.eco,
    name: o.name,
    pgn: o.pgn,
    uci: o.uci,
    epd: o.epd,
    winRate: o.total
      ? { white: o.white_wr, draw: o.draw_wr, black: o.black_wr, total: o.total }
      : null,
  };
}

// GET /openings?q=sicilian&color=black&sort=winrate&limit=20
openingsRouter.get('/', (c) => {
  const db = getDb();
  const q      = c.req.query('q') ?? '';
  const color  = c.req.query('color'); // 'white' | 'black' — filters by whose winrate to sort
  const moves  = c.req.query('moves'); // UCI move prefix e.g. "e2e4 c7c5"
  const sort   = c.req.query('sort') ?? 'eco'; // 'eco' | 'winrate'
  const limit  = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

  let sql = `SELECT * FROM openings WHERE 1=1`;
  const params: Record<string, string | number> = {};

  if (q) {
    sql += ` AND name LIKE @q COLLATE NOCASE`;
    params.q = `%${q}%`;
  }

  if (moves) {
    // Match openings whose UCI starts with the given move prefix
    sql += ` AND uci LIKE @moves`;
    params.moves = `${moves.trim()}%`;
  }

  if (sort === 'winrate') {
    const col = color === 'black' ? 'black_wr' : 'white_wr';
    sql += ` AND total IS NOT NULL ORDER BY ${col} DESC`;
  } else {
    sql += ` ORDER BY eco ASC`;
  }

  sql += ` LIMIT @limit`;
  params.limit = limit;

  const rows = db.prepare(sql).all(params) as Opening[];
  return c.json({ openings: rows.map(fmt), count: rows.length });
});

// GET /openings/:eco
// Returns the canonical (first inserted) opening for the given ECO code.
openingsRouter.get('/:eco', (c) => {
  const db  = getDb();
  const eco = c.req.param('eco').toUpperCase();
  const row = db.prepare(`SELECT * FROM openings WHERE eco = ? ORDER BY id ASC LIMIT 1`).get(eco) as Opening | undefined;
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(fmt(row));
});
