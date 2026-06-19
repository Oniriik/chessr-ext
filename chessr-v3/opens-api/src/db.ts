import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../data/openings.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS openings (
      id         INTEGER PRIMARY KEY,
      eco        TEXT NOT NULL,
      name       TEXT NOT NULL,
      pgn        TEXT NOT NULL,
      uci        TEXT NOT NULL,
      epd        TEXT NOT NULL UNIQUE,
      white_wins INTEGER,
      draws      INTEGER,
      black_wins INTEGER,
      total      INTEGER,
      white_wr   REAL,
      draw_wr    REAL,
      black_wr   REAL,
      fetched_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_openings_epd  ON openings(epd);
    CREATE INDEX IF NOT EXISTS idx_openings_eco  ON openings(eco);
    CREATE INDEX IF NOT EXISTS idx_openings_name ON openings(name COLLATE NOCASE);
  `);
}
