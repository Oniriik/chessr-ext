import Database from 'better-sqlite3';
import { getDb } from '../src/db.js';

export function seedTestDb() {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO openings
    (eco, name, pgn, uci, epd, white_wins, draws, black_wins, total, white_wr, draw_wr, black_wr, fetched_at)
    VALUES ('B20','Sicilian Defense','1. e4 c5','e2e4 c7c5',
      'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
      5000,3000,2000,10000,0.5,0.3,0.2,datetime('now'))`).run();
  db.prepare(`INSERT OR IGNORE INTO openings
    (eco, name, pgn, uci, epd, fetched_at)
    VALUES ('A00','Uncommon Opening','1. g4','g2g4',
      'rnbqkbnr/pppppppp/8/8/6P1/8/PPPPPP1P/RNBQKBNR b KQkq -',
      datetime('now'))`).run();
  db.prepare(`INSERT OR IGNORE INTO openings
    (eco, name, pgn, uci, epd, white_wins, draws, black_wins, total, white_wr, draw_wr, black_wr, fetched_at)
    VALUES ('C00','French Defense','1. e4 e6','e2e4 e7e6',
      'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
      4000,2000,4000,10000,0.4,0.2,0.4,datetime('now'))`).run();
}
