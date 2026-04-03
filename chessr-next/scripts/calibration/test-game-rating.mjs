#!/usr/bin/env node
/**
 * Test Game Rating Calibration
 *
 * Fetches last 10 games for a Chess.com user, runs our CAPS formula on the
 * position data, and compares with Chess.com's official CAPS accuracy.
 *
 * Usage: node test-game-rating.mjs <username> [games_count]
 * Example: node test-game-rating.mjs hikaru 10
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { WebSocket } = require('../../serveur/node_modules/ws');

const username = process.argv[2];
const gamesCount = parseInt(process.argv[3] || '10');

if (!username) {
  console.error('Usage: node test-game-rating.mjs <username> [games_count]');
  process.exit(1);
}

const REMEMBERME = process.env.CHESSCOM_REMEMBERME;
if (!REMEMBERME) {
  console.error('Set CHESSCOM_REMEMBERME env var');
  process.exit(1);
}

const COOKIE = `CHESSCOM_REMEMBERME=${REMEMBERME}`;

// ─── Chess.com win probability formula ───
function winProb(evalPawns) {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// ─── Our CAPS2 formulas to test ───

// V2: re-fit on real Chess.com data (refit-caps2.mjs)
function capsV2(diff) {
  if (diff <= 0) return 100;
  return Math.max(0, 100 * Math.exp(-0.63 * Math.pow(diff, 1.42)));
}

// V3: win% diff based (from fit-caps-v3)
function capsV3(bestEval, afterEval) {
  const wd = Math.max(0, winProb(bestEval) - winProb(afterEval));
  const threshold = 1.5;
  const k = 0.06;
  const p = 1.65;
  if (wd <= threshold) return 100;
  const adj = wd - threshold;
  return Math.max(0, 100 * Math.exp(-k * Math.pow(adj, p)));
}

// ─── Chess.com API helpers ───

async function fetchArchives(user) {
  const res = await fetch(`https://api.chess.com/pub/player/${user}/games/archives`, {
    headers: { 'User-Agent': 'Chessr/1.0' },
  });
  if (!res.ok) throw new Error(`Player ${user} not found (${res.status})`);
  const data = await res.json();
  return (data.archives || []).reverse(); // newest first
}

async function fetchGamesFromArchive(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Chessr/1.0' } });
  const data = await res.json();
  return (data.games || []).filter(g => g.url?.includes('/live/')).reverse();
}

// Decode Chess.com moveList to PGN
function charToSquareIdx(ch) {
  const cc = ch.charCodeAt(0);
  if (cc >= 97 && cc <= 122) return cc - 97;
  if (cc >= 65 && cc <= 90) return cc - 65 + 26;
  if (cc >= 48 && cc <= 57) return cc - 48 + 52;
  if (cc === 33) return 62;
  if (cc === 63) return 63;
  return -1;
}

function idxToSquare(idx) {
  return String.fromCharCode(97 + (idx % 8)) + (Math.floor(idx / 8) + 1);
}

async function fetchGameData(gameId) {
  const res = await fetch(`https://www.chess.com/callback/live/game/${gameId}?all=true`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Game ${gameId}: ${res.status}`);
  return res.json();
}

async function getAnalysisToken(gameId) {
  const res = await fetch(
    `https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=live`,
    { headers: { Accept: 'application/json', Cookie: COOKIE, 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) throw new Error(`Auth ${gameId}: ${res.status}`);
  const data = await res.json();
  return data.token;
}

function decodeMoveListToPGN(moveList, headers) {
  // We need chess.js for this but keep it simple - import dynamically
  const uciMoves = [];
  for (let i = 0; i + 1 < moveList.length; i += 2) {
    const fi = charToSquareIdx(moveList[i]);
    const ti = charToSquareIdx(moveList[i + 1]);
    if (fi < 0 || ti < 0) continue;
    uciMoves.push(idxToSquare(fi) + idxToSquare(ti));
  }
  // Build minimal PGN from headers - actual SAN isn't needed for analysis API
  // The analysis API needs PGN, so we'll use the public PGN from the game
  return null; // We'll use game.pgn instead
}

function fetchAnalysis(gameId, token, pgn) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://analysis.chess.com:443/v1/legacy/game-analysis');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 60000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        action: 'gameAnalysis',
        game: { pgn },
        options: {
          caps2: true, depth: 18, engineType: 'stockfish16 nnue', strength: 'Fast',
          source: {
            gameId, gameType: 'live', token,
            client: 'web', gameUuid: '', product: 'game review', userTimeZone: 'UTC',
          },
          tep: {
            ceeDebug: false, classificationv3: true, nullMoveRepresentation: '--',
            basicVariationThemes: false, speechv3: true, lang: 'en_US',
            coachLocale: 'en-US', coachTextId: 'Generic_coach', userColor: 'white',
          },
        },
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'error') { clearTimeout(timeout); ws.close(); reject(new Error(msg.message)); return; }
        if (msg.action === 'analyzeGame' && msg.data) { clearTimeout(timeout); ws.close(); resolve(msg.data); return; }
      } catch { /* ignore */ }
    });

    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ─── Main ───

async function main() {
  console.log(`\nFetching last ${gamesCount} games for ${username}...\n`);

  // Fetch games
  const archives = await fetchArchives(username);
  let games = [];
  for (const archUrl of archives) {
    if (games.length >= gamesCount) break;
    const archGames = await fetchGamesFromArchive(archUrl);
    games.push(...archGames);
  }
  games = games.slice(0, gamesCount);

  console.log(`Found ${games.length} games. Analyzing each with Chess.com API...\n`);

  const results = [];

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const gameId = g.url.split('/').pop();
    const isWhite = g.white.username.toLowerCase() === username.toLowerCase();
    const player = isWhite ? g.white : g.black;
    const opponent = isWhite ? g.black : g.white;
    const playerColor = isWhite ? 'white' : 'black';
    const opponentColor = isWhite ? 'black' : 'white';

    process.stdout.write(`  [${i + 1}/${games.length}] ${player.username} (${player.rating}) vs ${opponent.username} (${opponent.rating}) ${g.time_class}...`);

    try {
      // Get analysis token and run analysis
      const token = await getAnalysisToken(gameId);
      const analysis = await fetchAnalysis(gameId, token, g.pgn);

      // Chess.com's official CAPS + Game Rating (effectiveElo)
      const ccCapsPlayer = analysis.CAPS?.[playerColor]?.all;
      const ccCapsOpponent = analysis.CAPS?.[opponentColor]?.all;
      const gameRatingPlayer = analysis.reportCard?.[playerColor]?.effectiveElo;
      const gameRatingOpponent = analysis.reportCard?.[opponentColor]?.effectiveElo;

      // Extract positions for our calculation
      const positions = analysis.positions || [];
      const playerMoves = positions.filter(p => p.color === playerColor && p.classificationName !== 'book');
      const opponentMoves = positions.filter(p => p.color === opponentColor && p.classificationName !== 'book');

      // Compute our CAPS using V2 (raw diff)
      const playerV2Scores = playerMoves.map(p => capsV2(Math.abs(p.difference || 0)));
      const opponentV2Scores = opponentMoves.map(p => capsV2(Math.abs(p.difference || 0)));
      const ourV2Player = playerV2Scores.length ? playerV2Scores.reduce((a, b) => a + b, 0) / playerV2Scores.length : null;
      const ourV2Opponent = opponentV2Scores.length ? opponentV2Scores.reduce((a, b) => a + b, 0) / opponentV2Scores.length : null;

      results.push({
        gameId,
        timeClass: g.time_class,
        player: player.username,
        playerRating: player.rating,
        opponent: opponent.username,
        opponentRating: opponent.rating,
        playerColor,
        ccPlayer: ccCapsPlayer,
        ccOpponent: ccCapsOpponent,
        ourV2Player: ourV2Player,
        ourV2Opponent: ourV2Opponent,
        gameRatingPlayer,
        gameRatingOpponent,
        playerMoves: playerMoves.length,
        opponentMoves: opponentMoves.length,
      });

      console.log(` Accuracy=${ccCapsPlayer?.toFixed(1)}%  GameRating=${gameRatingPlayer || '?'}  (actual=${player.rating})`);
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
    }

    // Small delay to avoid rate limiting
    if (i < games.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  // ─── Summary ───
  console.log(`\n${'═'.repeat(110)}`);
  console.log('RESULTS COMPARISON');
  console.log(`${'═'.repeat(110)}\n`);

  console.log(
    'Game'.padEnd(12) +
    'TC'.padEnd(8) +
    'Player'.padEnd(20) +
    'Rating'.padEnd(8) +
    'Acc%'.padEnd(8) +
    'GameRtg'.padEnd(9) +
    'Δ'.padEnd(7) +
    '│ '.padEnd(3) +
    'Opponent'.padEnd(20) +
    'Rating'.padEnd(8) +
    'Acc%'.padEnd(8) +
    'GameRtg'.padEnd(9) +
    'Δ'.padEnd(7)
  );
  console.log('─'.repeat(120));

  const deltas = [];

  for (const r of results) {
    const deltaP = r.gameRatingPlayer && r.playerRating ? r.gameRatingPlayer - r.playerRating : NaN;
    const deltaO = r.gameRatingOpponent && r.opponentRating ? r.gameRatingOpponent - r.opponentRating : NaN;
    if (!isNaN(deltaP)) deltas.push({ acc: r.ccPlayer, rating: r.playerRating, gameRating: r.gameRatingPlayer, tc: r.timeClass });
    if (!isNaN(deltaO)) deltas.push({ acc: r.ccOpponent, rating: r.opponentRating, gameRating: r.gameRatingOpponent, tc: r.timeClass });

    console.log(
      r.gameId.slice(-10).padEnd(12) +
      r.timeClass.padEnd(8) +
      r.player.slice(0, 18).padEnd(20) +
      String(r.playerRating).padEnd(8) +
      (r.ccPlayer?.toFixed(1) || '-').padEnd(8) +
      String(r.gameRatingPlayer || '-').padEnd(9) +
      (!isNaN(deltaP) ? (deltaP >= 0 ? '+' : '') + deltaP : '-').padEnd(7) +
      '│ '.padEnd(3) +
      r.opponent.slice(0, 18).padEnd(20) +
      String(r.opponentRating).padEnd(8) +
      (r.ccOpponent?.toFixed(1) || '-').padEnd(8) +
      String(r.gameRatingOpponent || '-').padEnd(9) +
      (!isNaN(deltaO) ? (deltaO >= 0 ? '+' : '') + deltaO : '-').padEnd(7)
    );
  }

  // Show accuracy → game rating data points for curve fitting
  if (deltas.length > 0) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('ACCURACY → GAME RATING DATA POINTS (for curve fitting)');
    console.log(`${'═'.repeat(60)}\n`);
    console.log('Acc%'.padEnd(8) + 'Rating'.padEnd(8) + 'GameRtg'.padEnd(9) + 'Δ'.padEnd(7) + 'TC');
    console.log('─'.repeat(40));
    for (const d of deltas.sort((a, b) => a.acc - b.acc)) {
      const delta = d.gameRating - d.rating;
      console.log(
        d.acc.toFixed(1).padEnd(8) +
        String(d.rating).padEnd(8) +
        String(d.gameRating).padEnd(9) +
        ((delta >= 0 ? '+' : '') + delta).padEnd(7) +
        d.tc
      );
    }
  }

  // ─── Dump raw fields for first game to understand data structure ───
  if (results.length > 0) {
    const firstGame = games[0];
    const gameId = firstGame.url.split('/').pop();
    const isWhite = firstGame.white.username.toLowerCase() === username.toLowerCase();
    const playerColor = isWhite ? 'white' : 'black';

    console.log(`\n${'═'.repeat(100)}`);
    console.log(`RAW POSITION DATA — Game ${gameId} (${playerColor})`);
    console.log(`${'═'.repeat(100)}\n`);

    try {
      const token = await getAnalysisToken(gameId);
      const analysis = await fetchAnalysis(gameId, token, firstGame.pgn);

      // Show all top-level keys in analysis
      console.log('Analysis top-level keys:', Object.keys(analysis).join(', '));
      console.log('CAPS:', JSON.stringify(analysis.CAPS, null, 2));
      console.log('reportCard:', JSON.stringify(analysis.reportCard, null, 2));
      console.log('gameSummary:', typeof analysis.gameSummary === 'string' ? analysis.gameSummary.slice(0, 200) : JSON.stringify(analysis.gameSummary)?.slice(0, 200));
      console.log('E1:', JSON.stringify(analysis.E1, null, 2));
      console.log('tallies:', JSON.stringify(analysis.tallies, null, 2));
      console.log('');

      const positions = analysis.positions || [];
      const playerMoves = positions.filter(p => p.color === playerColor);

      // Dump first 3 non-book positions fully to see all available fields
      const nonBook = playerMoves.filter(p => p.classificationName !== 'book');
      console.log(`First 3 non-book ${playerColor} positions (full fields):\n`);
      for (let i = 0; i < Math.min(3, nonBook.length); i++) {
        const pos = nonBook[i];
        // Show all keys except speech (too verbose)
        const stripped = { ...pos };
        delete stripped.speech;
        delete stripped.bestMove?.speech;
        delete stripped.playedMove?.speech;
        console.log(`--- Position ${i + 1} ---`);
        console.log(JSON.stringify(stripped, null, 2));
        console.log('');
      }

      // Then show compact table for all moves
      console.log(`\nPER-MOVE TABLE:\n`);
      console.log(
        'Ply'.padEnd(5) +
        'Class'.padEnd(14) +
        'difference'.padEnd(12) +
        'CC_CAPS2'.padEnd(10) +
        'Our_V2'.padEnd(10) +
        'Error'.padEnd(8) +
        'Extra fields'
      );
      console.log('─'.repeat(100));

      for (const pos of playerMoves) {
        const diff = Math.abs(pos.difference || 0);
        const cls = pos.classificationName || '?';
        const ccCaps = pos.caps2;
        const ourV2 = cls === 'book' ? 100 : capsV2(diff);
        const err = ccCaps != null ? (ourV2 - ccCaps).toFixed(1) : '-';

        // Collect extra numeric fields
        const extras = [];
        if (pos.winChance != null) extras.push(`wc=${pos.winChance}`);
        if (pos.expectedPoints != null) extras.push(`ep=${pos.expectedPoints}`);
        if (pos.expectedPointsLost != null) extras.push(`epLost=${pos.expectedPointsLost}`);
        if (pos.bestMove?.evaluation != null) extras.push(`bestEval=${JSON.stringify(pos.bestMove.evaluation)}`);
        if (pos.playedMove?.evaluation != null) extras.push(`playedEval=${JSON.stringify(pos.playedMove.evaluation)}`);

        console.log(
          String(pos.ply || '?').padEnd(5) +
          cls.padEnd(14) +
          diff.toFixed(4).padEnd(12) +
          (ccCaps?.toFixed(1) || '-').padEnd(10) +
          ourV2.toFixed(1).padEnd(10) +
          err.padEnd(8) +
          extras.join('  ')
        );
      }
    } catch (err) {
      console.log(`Failed to get detail: ${err.message}`);
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
