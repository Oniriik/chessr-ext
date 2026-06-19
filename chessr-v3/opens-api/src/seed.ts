/**
 * Seed script — run once (or to refresh):
 *   npm run seed
 *
 * 1. Downloads the lichess-org/chess-openings TSV files (ECO A–E)
 * 2. Derives UCI moves and EPD from PGN using chess.js
 * 3. Inserts all openings into SQLite
 * 4. Fetches win rates from Lichess Explorer for each opening (throttled)
 *
 * Note: the TSV format changed — it now has only eco, name, pgn columns.
 */

import { Chess } from 'chess.js';
import { getDb } from './db.js';

const TSV_BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const EXPLORER  = 'https://explorer.lichess.ovh/masters';
const THROTTLE_MS = 600; // ~1.6 req/s — well within Lichess limits

async function fetchTsv(letter: string): Promise<string> {
  const res = await fetch(`${TSV_BASE}/${letter}.tsv`);
  if (!res.ok) throw new Error(`TSV fetch failed: ${letter} ${res.status}`);
  return res.text();
}

function pgnToUciAndEpd(pgn: string): { uci: string; epd: string } | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    const uci = history.map((m) => m.from + m.to + (m.promotion ?? '')).join(' ');
    // EPD = first 4 FEN fields (position, active, castling, en passant)
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    return { uci, epd };
  } catch {
    return null;
  }
}

function parseTsv(raw: string): { eco: string; name: string; pgn: string; uci: string; epd: string }[] {
  return raw
    .split('\n')
    .slice(1) // skip header
    .filter(Boolean)
    .map((line) => {
      const [eco, name, pgn] = line.split('\t');
      const derived = pgnToUciAndEpd(pgn);
      if (!derived) return null;
      return { eco, name, pgn, ...derived };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && Boolean(r.eco) && Boolean(r.epd));
}

async function fetchWinRate(epd: string): Promise<{ white: number; draws: number; black: number; total: number } | null> {
  const token = process.env.LICHESS_TOKEN;
  try {
    const url = `${EXPLORER}?fen=${encodeURIComponent(epd)}&moves=0`;
    const headers: Record<string, string> = { 'User-Agent': 'Chessr (contact: oniriik.dev@gmail.com)' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const json = await res.json() as { white: number; draws: number; black: number };
    const total = json.white + json.draws + json.black;
    return { white: json.white, draws: json.draws, black: json.black, total };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const db = getDb();

  // 1. Load TSVs
  console.log('Fetching TSV files from lichess-org/chess-openings...');
  const letters = ['a', 'b', 'c', 'd', 'e'];
  const rows: ReturnType<typeof parseTsv> = [];
  for (const l of letters) {
    const raw = await fetchTsv(l);
    const parsed = parseTsv(raw);
    rows.push(...parsed);
    console.log(`  ${l.toUpperCase()}: ${parsed.length} openings`);
  }
  console.log(`Total: ${rows.length} openings`);

  // 2. Insert all openings (without win rates yet)
  const insert = db.prepare(`
    INSERT OR IGNORE INTO openings (eco, name, pgn, uci, epd)
    VALUES (@eco, @name, @pgn, @uci, @epd)
  `);
  const insertMany = db.transaction((items: typeof rows) => {
    for (const r of items) insert.run(r);
  });
  insertMany(rows);
  console.log('Openings inserted.');

  // 3. Fetch win rates for those without one
  const pending = db.prepare(`SELECT eco, epd FROM openings WHERE fetched_at IS NULL`).all() as { eco: string; epd: string }[];
  console.log(`Fetching win rates for ${pending.length} openings...`);

  const update = db.prepare(`
    UPDATE openings
    SET white_wins=@white, draws=@draws, black_wins=@black, total=@total,
        white_wr=@white_wr, draw_wr=@draw_wr, black_wr=@black_wr,
        fetched_at=datetime('now')
    WHERE epd=@epd
  `);

  let done = 0;
  for (const { eco, epd } of pending) {
    const wr = await fetchWinRate(epd);
    if (wr && wr.total > 0) {
      update.run({
        epd,
        white: wr.white,
        draws: wr.draws,
        black: wr.black,
        total: wr.total,
        white_wr: wr.white / wr.total,
        draw_wr:  wr.draws / wr.total,
        black_wr: wr.black / wr.total,
      });
    } else {
      // Mark as fetched even if no data (avoid re-fetching obscure openings)
      db.prepare(`UPDATE openings SET fetched_at=datetime('now') WHERE epd=@epd`).run({ epd });
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${pending.length}...`);
    await sleep(THROTTLE_MS);
  }

  console.log('Done. Win rates populated.');
}

main().catch((e) => { console.error(e); process.exit(1); });
