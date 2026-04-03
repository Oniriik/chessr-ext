/**
 * Play DNA — Scout Report Generator
 * Analyzes last 10 games of a Chess.com player and generates a human profile report.
 *
 * Usage: node play-dna.mjs <username>
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { WebSocket } = require('../../serveur/node_modules/ws');

const USERNAME = process.argv[2];
if (!USERNAME) { console.log('Usage: node play-dna.mjs <username>'); process.exit(1); }

const MAX_GAMES = 10;

const COOKIES = `PHPSESSID=85d4b629bada2aac71ff3749bc7d151a; ACCESS_TOKEN=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IjU0OGRmOTcwZGEzYzRjMWFkNjAwYTk3NTg3YzIxM2E0MTkwYjNjZWYifQ.eyJhdWQiOiI4ZWVhMDExMC1mOWMxLTExZWYtOWNlNi03ZmQxMjYxMmEzZTMiLCJqdGkiOiJmYmUyMzRjNjc1YTRjZmFlZjQwZWMyOTBlNTYxNzNmODhkMzMzM2UyZTQ2NjI3MzlhNDI0MTQ2OTc0MTcxMWQ0OTQwNzc0NTBhMmU2OGJjNSIsImlhdCI6MTc3NDk0MzEwOS42MDU0NzEsIm5iZiI6MTc3NDk0MzEwOS42MDU0NzMsImV4cCI6MTc3NTAyOTUwOS42MDE3MjMsInN1YiI6ImE1OWE2YTY2LTJhZDYtMTFmMS05MzE1LTgxYzQ3Y2Y0MzZjZCIsInNjb3BlcyI6W10sImxvY2FsZSI6ImVuX1VTIn0.o9W8feE7AKeNq4u81wLgNoVFRSZaC3su4ap3SQkAWkzSXC2f0yxVnsHf7WaLMiuNH64nZ-ORZPx5CnPVBW9935A0WuC1_fnfXbvL7YtOFKtNd9rbv8SUVY0Znt0urIH3LNH1cWTVgQrQS3FXGjgUoqB0nmZevIKn1onk5uwFldcc_AcboOkHbCYeTwtxhDktRC_6IkhxrEzHaJIrq617DyPSIQBMeodPEpggljw_JZth4OOGoLfI2-G0_0uzLAcz8N74-odfiEHzSz_PkPM82YgZysxQKVlE00wkF24cXT2873ZgHxd6EpQCA8_oF3IaIzlZzw4FhQ0OENvFBql_Ew; CHESSCOM_REMEMBERME=Chess.WebBundle.Entity.User%3AY2hlc3NyLWlv%3A1806479109%3AQNo_8rYy9KgjZzfvEd-6J0P5jA_wnJwP5C_lU2MG1Cw~HmRAKEQJsYhucIYyjgIUpPbzcZn_vVC_TN8rC3oVOp4~`;

// ─── Time control classification ───
function classifyTimeControl(tc) {
  if (!tc) return 'unknown';
  const parts = tc.split('+');
  const base = parseInt(parts[0]);
  const inc = parseInt(parts[1] || '0');
  const total = base + inc * 40; // estimated game duration
  if (total < 180) return 'bullet';
  if (total < 600) return 'blitz';
  if (total < 1800) return 'rapid';
  return 'classical';
}

function timeControlLabel(tc) {
  return { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', unknown: '?' }[tc] || tc;
}

// Expected accuracy norms by time control and rating range
const NORMS = {
  bullet:    { 800: 50, 1000: 55, 1200: 60, 1400: 65, 1600: 70, 1800: 75, 2000: 80, 2200: 85, 2400: 90 },
  blitz:     { 800: 55, 1000: 60, 1200: 65, 1400: 70, 1600: 75, 1800: 80, 2000: 85, 2200: 88, 2400: 92 },
  rapid:     { 800: 60, 1000: 65, 1200: 70, 1400: 75, 1600: 80, 1800: 85, 2000: 88, 2200: 91, 2400: 94 },
  classical: { 800: 60, 1000: 65, 1200: 70, 1400: 75, 1600: 80, 1800: 85, 2000: 88, 2200: 91, 2400: 94 },
};

// Cadence-specific thresholds — what's "suspicious" differs by speed
const THRESHOLDS = {
  bullet: {
    accStdDev: 8,       // stddev below this = too consistent
    pieceVar: 8,        // piece accuracy variance below this = suspicious
    phaseVar: 5,        // phase accuracy variance below this = suspicious
    thinkRatio: 1.0,    // think/reflex ratio below this = suspicious
    timeCV: 0.4,        // coefficient of variation below this = robotic
    bestMoveRate: 55,   // best move % above this = suspicious (non-book)
    deltaFlag: 12,      // accuracy above expected + this = flag
  },
  blitz: {
    accStdDev: 6,
    pieceVar: 6,
    phaseVar: 4,
    thinkRatio: 1.5,
    timeCV: 0.35,
    bestMoveRate: 65,
    deltaFlag: 10,
  },
  rapid: {
    accStdDev: 5,
    pieceVar: 5,
    phaseVar: 3,
    thinkRatio: 2.0,
    timeCV: 0.3,
    bestMoveRate: 70,
    deltaFlag: 8,
  },
  classical: {
    accStdDev: 5,
    pieceVar: 5,
    phaseVar: 3,
    thinkRatio: 2.0,
    timeCV: 0.3,
    bestMoveRate: 70,
    deltaFlag: 8,
  },
};

function getThresholds(tcType) {
  return THRESHOLDS[tcType] || THRESHOLDS.blitz;
}

// Get the dominant time control (most games played)
function getDominantTc(results) {
  const counts = {};
  for (const r of results) counts[r.tcType] = (counts[r.tcType] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'blitz';
}

// Normalize accuracy: delta from expected for that cadence/rating
function normalizeAccuracy(acc, rating, tcType) {
  if (acc == null) return null;
  const expected = getExpectedAccuracy(rating, tcType);
  return acc - expected; // positive = above expected, negative = below
}

function getExpectedAccuracy(rating, tcType) {
  const norms = NORMS[tcType] || NORMS.blitz;
  const brackets = Object.keys(norms).map(Number).sort((a, b) => a - b);
  if (rating <= brackets[0]) return norms[brackets[0]];
  if (rating >= brackets[brackets.length - 1]) return norms[brackets[brackets.length - 1]];
  for (let i = 0; i < brackets.length - 1; i++) {
    if (rating >= brackets[i] && rating < brackets[i + 1]) {
      const pct = (rating - brackets[i]) / (brackets[i + 1] - brackets[i]);
      return norms[brackets[i]] + pct * (norms[brackets[i + 1]] - norms[brackets[i]]);
    }
  }
  return 70;
}

// ─── Clock time extraction from PGN ───
function extractClockTimes(pgn) {
  const whiteTimes = [];
  const blackTimes = [];
  const clkRegex = /\{?\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]\}?/g;
  let match;
  let moveIdx = 0;
  while ((match = clkRegex.exec(pgn)) !== null) {
    const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
    if (moveIdx % 2 === 0) whiteTimes.push(seconds);
    else blackTimes.push(seconds);
    moveIdx++;
  }
  return { whiteTimes, blackTimes };
}

function calcThinkTimes(clockTimes, increment) {
  const thinkTimes = [];
  for (let i = 1; i < clockTimes.length; i++) {
    const think = clockTimes[i - 1] - clockTimes[i] + increment;
    thinkTimes.push(Math.max(0, think));
  }
  return thinkTimes;
}

// ─── Chess.com helpers ───
function charToIdx(ch) {
  const cc = ch.charCodeAt(0);
  if (cc >= 97 && cc <= 122) return cc - 97;
  if (cc >= 65 && cc <= 90) return cc - 65 + 26;
  if (cc >= 48 && cc <= 57) return cc - 48 + 52;
  if (cc === 33) return 62;
  if (cc === 63) return 63;
  return -1;
}

function decodeMoveList(moveList, headers) {
  const uciMoves = [];
  let i = 0;
  while (i + 1 < moveList.length) {
    const fi = charToIdx(moveList[i]), ti = charToIdx(moveList[i + 1]);
    i += 2;
    if (fi < 0 || ti < 0) continue;
    uciMoves.push(
      String.fromCharCode(97 + (fi % 8)) + (Math.floor(fi / 8) + 1) +
      String.fromCharCode(97 + (ti % 8)) + (Math.floor(ti / 8) + 1)
    );
  }
  const pyFile = '/tmp/decode_ml.py';
  writeFileSync(pyFile, `
import chess, json
uci_moves = json.loads('${JSON.stringify(uciMoves)}')
board = chess.Board()
san_moves = []
for uci in uci_moves:
    try:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            for p in ['q','r','b','n']:
                pm = chess.Move.from_uci(uci+p)
                if pm in board.legal_moves: move=pm; break
        if move in board.legal_moves:
            san_moves.append(board.san(move))
            board.push(move)
        else: break
    except: break
lines=[]
for i,s in enumerate(san_moves):
    n=i//2+1
    if i%2==0: lines.append(f"{n}. {s}")
    else: lines[-1]+=f" {s}"
print(" ".join(lines))
`);
  const san = execSync(`python3 ${pyFile}`, { encoding: 'utf8' }).trim();
  const h = headers;
  return `[Event "${h.Event || ''}"]\n[Site "Chess.com"]\n[White "${h.White}"]\n[Black "${h.Black}"]\n[Result "${h.Result}"]\n[WhiteElo "${h.WhiteElo}"]\n[BlackElo "${h.BlackElo}"]\n[TimeControl "${h.TimeControl || ''}"]\n[ECO "${h.ECO || ''}"]\n\n${san} ${h.Result}`;
}

async function getToken(gameId, gameType) {
  const res = await fetch(`https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=${gameType}`, {
    headers: { 'Accept': 'application/json', 'Cookie': COOKIES, 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) return null;
  return (await res.json()).token;
}

function analyzeViaWS(gameId, gameType, token, pgn) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://analysis.chess.com:443/v1/legacy/game-analysis');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 60000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        action: 'gameAnalysis',
        game: { pgn },
        options: {
          caps2: true, depth: 18, engineType: 'stockfish16 nnue', strength: 'Fast',
          source: { gameId, gameType, token, client: 'web', gameUuid: '', product: 'game review', userTimeZone: 'UTC' },
          tep: { ceeDebug: false, classificationv3: true, nullMoveRepresentation: '--', basicVariationThemes: false, speechv3: true, lang: 'en_US', coachLocale: 'en-US', coachTextId: 'Generic_coach' },
        },
      }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'error') { clearTimeout(timeout); ws.close(); reject(new Error(msg.message)); }
      if (msg.action === 'analyzeGame' && msg.data) { clearTimeout(timeout); ws.close(); resolve(msg.data); }
    });
    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

// ─── Stats helpers ───
const fmt = (v) => v != null ? v.toFixed(1) : '-';
const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const stddev = (arr) => {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1));
};
const bar = (val, max = 100, width = 20) => {
  const filled = Math.round((val / max) * width);
  return '\u2588'.repeat(Math.max(0, filled)) + '\u2591'.repeat(Math.max(0, width - filled));
};

// ─── Main ───
async function main() {
  console.log(`\n  Play DNA — Scout Report`);
  console.log(`  Player: ${USERNAME}\n`);

  // Fetch archives
  process.stdout.write('  Fetching game history... ');
  const archRes = await fetch(`https://api.chess.com/pub/player/${USERNAME}/games/archives`, { headers: { 'User-Agent': 'Chessr/1.0' } });
  if (!archRes.ok) { console.log('Player not found'); process.exit(1); }
  const archives = (await archRes.json()).archives || [];
  console.log('ok');

  // Collect last games from archives
  let allGames = [];
  for (let i = archives.length - 1; i >= 0 && allGames.length < MAX_GAMES; i--) {
    const gRes = await fetch(archives[i], { headers: { 'User-Agent': 'Chessr/1.0' } });
    const gData = await gRes.json();
    const liveGames = (gData.games || []).filter(g => g.url?.includes('/live/'));
    allGames = [...liveGames, ...allGames];
  }
  const games = allGames.slice(-MAX_GAMES);
  console.log(`  Found ${games.length} live games\n`);

  if (games.length === 0) { console.log('  No games found.'); process.exit(0); }

  // Analyze each game
  const results = [];
  for (let gi = 0; gi < games.length; gi++) {
    const g = games[gi];
    const id = g.url?.split('/').pop();
    const isWhite = g.white?.username?.toLowerCase() === USERNAME.toLowerCase();
    const playerColor = isWhite ? 'white' : 'black';
    const opponentColor = isWhite ? 'black' : 'white';
    const playerName = isWhite ? g.white?.username : g.black?.username;
    const opponentName = isWhite ? g.black?.username : g.white?.username;
    const playerRating = isWhite ? g.white?.rating : g.black?.rating;
    const opponentRating = isWhite ? g.black?.rating : g.white?.rating;
    const result = isWhite
      ? (g.white?.result === 'win' ? 'W' : g.black?.result === 'win' ? 'L' : 'D')
      : (g.black?.result === 'win' ? 'W' : g.white?.result === 'win' ? 'L' : 'D');
    const tc = g.time_control;
    const tcType = classifyTimeControl(tc);
    const increment = parseInt((tc || '').split('+')[1] || '0');

    process.stdout.write(`  Analyzing ${gi + 1}/${games.length}  ${g.white?.username} vs ${g.black?.username}... `);

    try {
      // Fetch game data for moveList
      const gdRes = await fetch(`https://www.chess.com/callback/live/game/${id}?all=true`, { headers: { 'Accept': 'application/json' } });
      const gdData = await gdRes.json();
      const pgn = decodeMoveList(gdData.game.moveList, gdData.game.pgnHeaders);

      const token = await getToken(id, 'live');
      if (!token) { console.log('skip (no token)'); continue; }

      const analysis = await analyzeViaWS(id, 'live', token, pgn);

      // Extract clock times from public PGN
      const publicPgn = g.pgn || '';
      const clocks = extractClockTimes(publicPgn);
      const playerClocks = playerColor === 'white' ? clocks.whiteTimes : clocks.blackTimes;
      const thinkTimes = calcThinkTimes(playerClocks, increment);

      // Count classifications for player
      const cls = {};
      const clsByType = { book: [], nonBook: [] }; // thinkTimes indexed by trivial/non-trivial
      let posIdx = 0;
      for (const pos of analysis.positions || []) {
        if (pos.color !== playerColor) continue;
        const cn = pos.classificationName;
        if (!cn) continue;
        cls[cn] = (cls[cn] || 0) + 1;

        // Map think time to this move
        const tt = thinkTimes[posIdx] ?? null;
        if (tt !== null) {
          if (cn === 'book') clsByType.book.push(tt);
          else clsByType.nonBook.push(tt);
        }
        posIdx++;
      }

      // Think times by classification
      const thinkByClass = {};
      posIdx = 0;
      for (const pos of analysis.positions || []) {
        if (pos.color !== playerColor) continue;
        const cn = pos.classificationName;
        if (!cn) { continue; }
        const tt = thinkTimes[posIdx] ?? null;
        if (tt !== null) {
          if (!thinkByClass[cn]) thinkByClass[cn] = [];
          thinkByClass[cn].push(tt);
        }
        posIdx++;
      }

      // Think times for critical vs non-critical positions
      const criticalTimes = [];
      const calmTimes = [];
      posIdx = 0;
      for (const pos of analysis.positions || []) {
        if (pos.color !== playerColor) { continue; }
        const tt = thinkTimes[posIdx] ?? null;
        if (tt !== null && pos.classificationName !== 'book') {
          if (pos.bestMove?.isPositionCritical) criticalTimes.push(tt);
          else calmTimes.push(tt);
        }
        posIdx++;
      }

      const caps = analysis.CAPS?.[playerColor];
      console.log(`${fmt(caps?.all)}%`);

      results.push({
        id, playerName, opponentName, playerRating, opponentRating, result, playerColor,
        tc, tcType, increment,
        caps,
        opponentCaps: analysis.CAPS?.[opponentColor],
        classifications: cls,
        thinkByClass,
        criticalTimes,
        calmTimes,
        thinkTimes,
        bookThinkTimes: clsByType.book,
        nonBookThinkTimes: clsByType.nonBook,
        positions: analysis.positions,
        bookPly: analysis.bookPly,
      });
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
  }

  if (results.length === 0) { console.log('\n  No games analyzed.'); process.exit(0); }

  // ─── Aggregate Stats ───
  const avgRating = mean(results.map(r => r.playerRating).filter(Boolean));
  const dominantTc = getDominantTc(results);
  const domThresh = getThresholds(dominantTc);

  // By time control
  const byTc = {};
  for (const r of results) {
    if (!byTc[r.tcType]) byTc[r.tcType] = [];
    byTc[r.tcType].push(r);
  }

  // Normalized accuracy deltas (cross-cadence comparable)
  const normalizedDeltas = results
    .map(r => normalizeAccuracy(r.caps?.all, r.playerRating, r.tcType))
    .filter(d => d != null);
  const avgDelta = mean(normalizedDeltas);
  const deltaStdDev = stddev(normalizedDeltas);

  // Per-cadence aggregate helper
  function aggregateTcGroup(tcGames, tcType) {
    const thresh = getThresholds(tcType);
    const accs = tcGames.map(r => r.caps?.all).filter(Boolean);
    const avgRat = mean(tcGames.map(r => r.playerRating).filter(Boolean));
    const expected = getExpectedAccuracy(avgRat || 0, tcType);

    // Pieces
    const pieceAccs = {};
    for (const p of pieceKeys) {
      const vals = tcGames.map(r => r.caps?.[p]).filter(v => v != null && v > 0);
      if (vals.length > 0) pieceAccs[p] = { mean: mean(vals), stddev: stddev(vals) };
    }

    // Phases
    const phaseAccs = {};
    for (const ph of ['gp0', 'gp1', 'gp2']) {
      const vals = tcGames.map(r => r.caps?.[ph]).filter(v => v != null);
      if (vals.length > 0) phaseAccs[ph] = { mean: mean(vals), stddev: stddev(vals) };
    }

    // Classifications
    const cls = {};
    let total = 0;
    for (const r of tcGames) {
      for (const [k, v] of Object.entries(r.classifications)) {
        cls[k] = (cls[k] || 0) + v;
        total += v;
      }
    }
    const nonBookTotal = total - (cls.book || 0);
    const bestRate = nonBookTotal > 0 ? ((cls.best || 0) / nonBookTotal) * 100 : 0;

    // Think times
    const thinkTimes = tcGames.flatMap(r => r.thinkTimes);
    const critTimes = tcGames.flatMap(r => r.criticalTimes);
    const calmTimes = tcGames.flatMap(r => r.calmTimes);
    const thinkByClass = {};
    for (const r of tcGames) {
      for (const [c, times] of Object.entries(r.thinkByClass)) {
        if (!thinkByClass[c]) thinkByClass[c] = [];
        thinkByClass[c].push(...times);
      }
    }

    return {
      tcType, thresh, accs, avgRat, expected,
      avgAcc: mean(accs), accStd: stddev(accs),
      delta: mean(accs) != null ? mean(accs) - expected : null,
      pieceAccs, phaseAccs,
      cls, totalMoves: total, nonBookTotal, bestRate,
      thinkTimes, critTimes, calmTimes, thinkByClass,
      thinkMean: mean(thinkTimes), thinkStd: stddev(thinkTimes),
    };
  }

  const pieceKeys = ['K', 'Q', 'R', 'B', 'N', 'P'];
  const pieceLabels = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };

  // Build per-tc aggregates
  const tcAggs = {};
  for (const [tcType, tcGames] of Object.entries(byTc)) {
    tcAggs[tcType] = aggregateTcGroup(tcGames, tcType);
  }

  // Global aggregates (for sections that make sense globally)
  const clsOrder = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];

  // ─── Generate Report ───
  const wins = results.filter(r => r.result === 'W').length;
  const losses = results.filter(r => r.result === 'L').length;
  const draws = results.filter(r => r.result === 'D').length;
  const tcList = Object.keys(byTc);
  const isMultiTc = tcList.length > 1;

  let out = '';
  const log = (s = '') => { out += s + '\n'; };

  log(`\n${'='.repeat(60)}`);
  log(`  PLAY DNA — ${USERNAME}`);
  log(`  ${results.length} games analyzed | Avg rating: ${Math.round(avgRating || 0)}`);
  log(`  W: ${wins} / L: ${losses} / D: ${draws}`);
  if (isMultiTc) log(`  Cadences: ${tcList.map(t => `${timeControlLabel(t)} (${byTc[t].length})`).join(', ')}`);
  log(`${'='.repeat(60)}`);

  // ─── Normalized overview (cross-cadence) ───
  if (isMultiTc) {
    log(`\n  --- Cross-Cadence Overview ---`);
    log(`  Normalized delta (accuracy vs expected for cadence/rating):`);
    log(`  Avg delta:  ${avgDelta >= 0 ? '+' : ''}${fmt(avgDelta)}%  (stddev ${fmt(deltaStdDev)})`);
    log(`  ${avgDelta > 15 ? '(!!) Consistently above expected across cadences' : avgDelta > 8 ? '(elevated)' : '(normal)'}`);
    log();
  }

  // ─── Per time control sections ───
  for (const [tcType, agg] of Object.entries(tcAggs)) {
    const t = agg.thresh;

    log(`  ${'~'.repeat(56)}`);
    log(`  ${timeControlLabel(tcType).toUpperCase()} — ${agg.accs.length} game${agg.accs.length > 1 ? 's' : ''} (avg rating ${Math.round(agg.avgRat || 0)})`);
    log(`  ${'~'.repeat(56)}`);

    // Accuracy summary
    const sign = agg.delta >= 0 ? '+' : '';
    log(`\n  Accuracy:     ${fmt(agg.avgAcc)}%  (expected ~${fmt(agg.expected)}% → delta ${sign}${fmt(agg.delta)}%)${agg.delta > t.deltaFlag ? ' (!!)' : ''}`);
    if (agg.accStd != null) {
      log(`  Consistency:  stddev ${fmt(agg.accStd)} ${agg.accStd < t.accStdDev ? `(!! too consistent for ${timeControlLabel(tcType).toLowerCase()})` : '(normal)'}`);
    }

    // Accuracy trend for this cadence
    const tcGames = byTc[tcType];
    log();
    for (let i = 0; i < tcGames.length; i++) {
      const r = tcGames[i];
      const acc = r.caps?.all;
      const d = normalizeAccuracy(acc, r.playerRating, tcType);
      const dStr = d != null ? `(${d >= 0 ? '+' : ''}${fmt(d)})` : '';
      log(`  ${String(i + 1).padStart(2)}. ${bar(acc || 0)} ${fmt(acc).padStart(5)}%  ${r.result}  vs ${r.opponentName} (${r.opponentRating})  ${dStr}`);
    }

    // Piece DNA for this cadence
    log(`\n  Piece DNA (${timeControlLabel(tcType)}):`);
    const pieceEntries = pieceKeys.filter(p => agg.pieceAccs[p]).map(p => ({ piece: p, ...agg.pieceAccs[p] }));
    pieceEntries.sort((a, b) => b.mean - a.mean);
    const weakest = pieceEntries[pieceEntries.length - 1];
    const strongest = pieceEntries[0];

    for (const { piece, mean: m, stddev: s } of pieceEntries) {
      const tag = piece === weakest?.piece ? ' <-- weakness' : piece === strongest?.piece ? ' <-- strength' : '';
      log(`  ${pieceLabels[piece].padEnd(8)} ${bar(m)} ${fmt(m).padStart(5)}%${tag}`);
    }

    const pieceVar = stddev(pieceEntries.map(e => e.mean));
    log(`  Piece variance: ${fmt(pieceVar)} ${pieceVar != null && pieceVar < t.pieceVar ? `(!! uniform for ${timeControlLabel(tcType).toLowerCase()})` : '(normal)'}`);

    // Phase balance for this cadence
    const phaseNames = { gp0: 'Opening', gp1: 'Middlegame', gp2: 'Endgame' };
    log(`\n  Phase Balance (${timeControlLabel(tcType)}):`);
    for (const [ph, data] of Object.entries(agg.phaseAccs)) {
      log(`  ${phaseNames[ph]?.padEnd(12) || ph} ${bar(data.mean)} ${fmt(data.mean).padStart(5)}%`);
    }
    const phaseVar = stddev(Object.values(agg.phaseAccs).map(d => d.mean));
    log(`  Phase variance: ${fmt(phaseVar)} ${phaseVar != null && phaseVar < t.phaseVar ? `(!! uniform for ${timeControlLabel(tcType).toLowerCase()})` : '(normal)'}`);

    // Move classifications for this cadence
    log(`\n  Move Profile (${timeControlLabel(tcType)}):`);
    for (const c of clsOrder) {
      const count = agg.cls[c] || 0;
      if (count === 0) continue;
      log(`  ${c.padEnd(12)} ${String(count).padStart(4)}  (${fmt((count / agg.totalMoves) * 100)}%)`);
    }
    log(`  Best move rate (non-book): ${fmt(agg.bestRate)}% ${agg.bestRate > t.bestMoveRate ? `(!! high for ${timeControlLabel(tcType).toLowerCase()})` : ''}`);

    // Tempo for this cadence
    if (agg.thinkTimes.length > 0) {
      log(`\n  Tempo (${timeControlLabel(tcType)}):`);
      log(`  Avg think time: ${fmt(agg.thinkMean)}s  (stddev ${fmt(agg.thinkStd)}s)`);

      // Think by classification
      for (const c of clsOrder) {
        const times = agg.thinkByClass[c];
        if (!times || times.length < 2) continue;
        log(`  ${c.padEnd(12)} ${fmt(mean(times)).padStart(5)}s avg  (${times.length} moves)`);
      }

      // Critical vs calm
      const critMean = mean(agg.critTimes);
      const calmMean = mean(agg.calmTimes);
      if (critMean != null && calmMean != null && calmMean > 0) {
        const ratio = critMean / calmMean;
        log(`\n  Think/Reflex ratio:`);
        log(`  Critical: ${fmt(critMean)}s  |  Calm: ${fmt(calmMean)}s  |  Ratio: ${ratio.toFixed(2)}x ${ratio < t.thinkRatio ? `(!! low for ${timeControlLabel(tcType).toLowerCase()})` : ratio > t.thinkRatio * 2 ? '(very human)' : '(normal)'}`);
      }

      // Time CV
      if (agg.thinkStd != null && agg.thinkMean > 0) {
        const cv = agg.thinkStd / agg.thinkMean;
        log(`  Time CV: ${cv.toFixed(2)} ${cv < t.timeCV ? `(!! robotic for ${timeControlLabel(tcType).toLowerCase()})` : '(normal)'}`);
      }
    }

    log();
  }

  // ─── YOUR DNA ───
  log(`${'='.repeat(60)}`);
  log(`  YOUR DNA`);
  log(`${'='.repeat(60)}`);

  for (const [tcType, agg] of Object.entries(tcAggs)) {
    const tcLabel = timeControlLabel(tcType);
    const pieceEntries = pieceKeys.filter(p => agg.pieceAccs[p]).map(p => ({ piece: p, ...agg.pieceAccs[p] }));
    pieceEntries.sort((a, b) => a.mean - b.mean);
    const weakest = pieceEntries[0];
    const strongest = pieceEntries[pieceEntries.length - 1];

    // Style detection
    // opening-focused vs endgame-focused vs balanced
    const op = agg.phaseAccs.gp0?.mean;
    const mid = agg.phaseAccs.gp1?.mean;
    const end = agg.phaseAccs.gp2?.mean;
    let style = 'All-rounder';
    if (op != null && mid != null) {
      if (op > mid + 10 && (!end || op > end + 10)) style = 'Opening specialist';
      else if (end != null && end > mid + 10 && end > op + 10) style = 'Endgame grinder';
      else if (mid != null && mid > op + 10) style = 'Tactical middlegame player';
    }
    // aggressive vs positional: high best% + low good% = sharp/tactical, high good% = positional
    const bestPct = agg.bestRate;
    const goodPct = agg.nonBookTotal > 0 ? ((agg.cls.good || 0) / agg.nonBookTotal) * 100 : 0;
    const blunderPct = agg.totalMoves > 0 ? (((agg.cls.blunder || 0) + (agg.cls.miss || 0)) / agg.totalMoves) * 100 : 0;
    if (bestPct > 45 && blunderPct > 3) style += ' / Risk-taker';
    else if (goodPct > 15 && blunderPct < 2) style += ' / Solid positional';

    log(`\n  --- ${tcLabel} Profile ---`);
    log(`  style:              ${style}`);
    log(`  accuracy:           ${fmt(agg.avgAcc)}% avg (expected ${fmt(agg.expected)}% for ${Math.round(agg.avgRat)})`);
    log(`  accuracy_stddev:    ${fmt(agg.accStd)}  — game-to-game variance`);
    log(`  delta_vs_expected:  ${agg.delta >= 0 ? '+' : ''}${fmt(agg.delta)}%`);

    log(`  strongest_piece:    ${strongest ? `${pieceLabels[strongest.piece]} (${fmt(strongest.mean)}%)` : '-'}`);
    log(`  weakest_piece:      ${weakest ? `${pieceLabels[weakest.piece]} (${fmt(weakest.mean)}%)` : '-'}`);
    log(`  piece_spread:       ${fmt(strongest?.mean - weakest?.mean)}pp  — diff between best and worst piece`);

    log(`  best_phase:         ${op != null && mid != null && end != null ? (op >= mid && op >= end ? `Opening (${fmt(op)}%)` : end >= mid ? `Endgame (${fmt(end)}%)` : `Middlegame (${fmt(mid)}%)`) : op != null && mid != null ? (op >= mid ? `Opening (${fmt(op)}%)` : `Middlegame (${fmt(mid)}%)`) : '-'}`);
    log(`  worst_phase:        ${op != null && mid != null && end != null ? (op <= mid && op <= end ? `Opening (${fmt(op)}%)` : end <= mid ? `Endgame (${fmt(end)}%)` : `Middlegame (${fmt(mid)}%)`) : op != null && mid != null ? (op <= mid ? `Opening (${fmt(op)}%)` : `Middlegame (${fmt(mid)}%)`) : '-'}`);
    log(`  phase_drop:         ${op != null && mid != null ? `${fmt(op - mid)}pp opening→middle` : '-'}${mid != null && end != null ? `, ${fmt(mid - end)}pp middle→end` : ''}`);

    log(`  best_move_rate:     ${fmt(agg.bestRate)}% (non-book)`);
    log(`  blunder_rate:       ${fmt(blunderPct)}%`);
    log(`  avg_think_time:     ${fmt(agg.thinkMean)}s`);

    const critMean = mean(agg.critTimes);
    const calmMean = mean(agg.calmTimes);
    const ratio = critMean != null && calmMean != null && calmMean > 0 ? critMean / calmMean : null;
    log(`  think_critical:     ${fmt(critMean)}s (${agg.critTimes.length} positions)`);
    log(`  think_calm:         ${fmt(calmMean)}s (${agg.calmTimes.length} positions)`);
    log(`  think_reflex_ratio: ${ratio != null ? ratio.toFixed(2) + 'x' : '-'}  — >1 = thinks more on hard moves`);

    // Blunder timing
    const blunderTimes = [...(agg.thinkByClass.blunder || []), ...(agg.thinkByClass.miss || [])];
    const blunderThinkAvg = mean(blunderTimes);
    log(`  blunder_avg_time:   ${fmt(blunderThinkAvg)}s  — ${blunderThinkAvg != null && agg.thinkMean != null ? (blunderThinkAvg < agg.thinkMean * 0.6 ? 'blunders when rushing' : blunderThinkAvg > agg.thinkMean * 1.4 ? 'blunders when overthinking' : 'no clear pattern') : 'not enough data'}`);
  }

  // ─── ANTI-CHEAT ANALYSIS ───
  log(`\n${'='.repeat(60)}`);
  log(`  ANTI-CHEAT ANALYSIS`);
  log(`${'='.repeat(60)}`);

  for (const [tcType, agg] of Object.entries(tcAggs)) {
    const t = agg.thresh;
    const tcLabel = timeControlLabel(tcType);
    const checks = [];

    // 1. Accuracy vs expected
    const deltaAbs = agg.delta != null ? agg.delta : 0;
    if (deltaAbs > t.deltaFlag + 5) {
      checks.push({ status: 'FAIL', label: 'accuracy_delta', value: `+${fmt(deltaAbs)}%`, threshold: `>${t.deltaFlag + 5}`, detail: 'way above expected for rating/cadence' });
    } else if (deltaAbs > t.deltaFlag) {
      checks.push({ status: 'WARN', label: 'accuracy_delta', value: `+${fmt(deltaAbs)}%`, threshold: `>${t.deltaFlag}`, detail: 'above expected for rating/cadence' });
    } else {
      checks.push({ status: 'PASS', label: 'accuracy_delta', value: `${deltaAbs >= 0 ? '+' : ''}${fmt(deltaAbs)}%`, threshold: `<${t.deltaFlag}`, detail: 'within expected range' });
    }

    // 2. Accuracy consistency (stddev)
    if (agg.accStd != null && agg.accs.length >= 3) {
      if (agg.accStd < t.accStdDev * 0.6) {
        checks.push({ status: 'FAIL', label: 'accuracy_consistency', value: `stddev ${fmt(agg.accStd)}`, threshold: `<${fmt(t.accStdDev * 0.6)}`, detail: 'extremely consistent, engines dont vary' });
      } else if (agg.accStd < t.accStdDev) {
        checks.push({ status: 'WARN', label: 'accuracy_consistency', value: `stddev ${fmt(agg.accStd)}`, threshold: `<${t.accStdDev}`, detail: 'too consistent for cadence' });
      } else {
        checks.push({ status: 'PASS', label: 'accuracy_consistency', value: `stddev ${fmt(agg.accStd)}`, threshold: `>${t.accStdDev}`, detail: 'normal human variance' });
      }
    }

    // 3. Best move rate
    if (agg.bestRate > t.bestMoveRate + 10) {
      checks.push({ status: 'FAIL', label: 'best_move_rate', value: `${fmt(agg.bestRate)}%`, threshold: `>${t.bestMoveRate + 10}%`, detail: 'engine-level best move rate' });
    } else if (agg.bestRate > t.bestMoveRate) {
      checks.push({ status: 'WARN', label: 'best_move_rate', value: `${fmt(agg.bestRate)}%`, threshold: `>${t.bestMoveRate}%`, detail: 'elevated best move rate' });
    } else {
      checks.push({ status: 'PASS', label: 'best_move_rate', value: `${fmt(agg.bestRate)}%`, threshold: `<${t.bestMoveRate}%`, detail: 'normal' });
    }

    // 4. Piece uniformity
    const pieceEntries = pieceKeys.filter(p => agg.pieceAccs[p]).map(p => ({ piece: p, ...agg.pieceAccs[p] }));
    const pieceVar = stddev(pieceEntries.map(e => e.mean));
    if (pieceVar != null) {
      if (pieceVar < t.pieceVar * 0.6) {
        checks.push({ status: 'FAIL', label: 'piece_uniformity', value: `var ${fmt(pieceVar)}`, threshold: `<${fmt(t.pieceVar * 0.6)}`, detail: 'all pieces same accuracy, engines have no weakness' });
      } else if (pieceVar < t.pieceVar) {
        checks.push({ status: 'WARN', label: 'piece_uniformity', value: `var ${fmt(pieceVar)}`, threshold: `<${t.pieceVar}`, detail: 'pieces too uniform' });
      } else {
        checks.push({ status: 'PASS', label: 'piece_uniformity', value: `var ${fmt(pieceVar)}`, threshold: `>${t.pieceVar}`, detail: 'human-like piece weaknesses' });
      }
    }

    // 5. Phase uniformity
    const phaseVar = stddev(Object.values(agg.phaseAccs).map(d => d.mean));
    if (phaseVar != null) {
      if (phaseVar < t.phaseVar * 0.5) {
        checks.push({ status: 'FAIL', label: 'phase_uniformity', value: `var ${fmt(phaseVar)}`, threshold: `<${fmt(t.phaseVar * 0.5)}`, detail: 'same accuracy in all phases' });
      } else if (phaseVar < t.phaseVar) {
        checks.push({ status: 'WARN', label: 'phase_uniformity', value: `var ${fmt(phaseVar)}`, threshold: `<${t.phaseVar}`, detail: 'phases too balanced' });
      } else {
        checks.push({ status: 'PASS', label: 'phase_uniformity', value: `var ${fmt(phaseVar)}`, threshold: `>${t.phaseVar}`, detail: 'normal phase variation' });
      }
    }

    // 6. Think/Reflex ratio
    const critMean = mean(agg.critTimes);
    const calmMean = mean(agg.calmTimes);
    if (critMean != null && calmMean != null && calmMean > 0) {
      const ratio = critMean / calmMean;
      if (ratio < t.thinkRatio * 0.5) {
        checks.push({ status: 'FAIL', label: 'think_reflex_ratio', value: `${ratio.toFixed(2)}x`, threshold: `<${(t.thinkRatio * 0.5).toFixed(1)}x`, detail: 'thinks LESS on hard moves than easy ones' });
      } else if (ratio < t.thinkRatio) {
        checks.push({ status: 'WARN', label: 'think_reflex_ratio', value: `${ratio.toFixed(2)}x`, threshold: `<${t.thinkRatio}x`, detail: 'not enough time differentiation' });
      } else {
        checks.push({ status: 'PASS', label: 'think_reflex_ratio', value: `${ratio.toFixed(2)}x`, threshold: `>${t.thinkRatio}x`, detail: 'thinks more on hard positions' });
      }
    }

    // 7. Time CV
    if (agg.thinkStd != null && agg.thinkMean > 0) {
      const cv = agg.thinkStd / agg.thinkMean;
      if (cv < t.timeCV * 0.6) {
        checks.push({ status: 'FAIL', label: 'time_rhythm', value: `CV ${cv.toFixed(2)}`, threshold: `<${(t.timeCV * 0.6).toFixed(2)}`, detail: 'robotic constant tempo' });
      } else if (cv < t.timeCV) {
        checks.push({ status: 'WARN', label: 'time_rhythm', value: `CV ${cv.toFixed(2)}`, threshold: `<${t.timeCV}`, detail: 'low time variation' });
      } else {
        checks.push({ status: 'PASS', label: 'time_rhythm', value: `CV ${cv.toFixed(2)}`, threshold: `>${t.timeCV}`, detail: 'natural time rhythm' });
      }
    }

    // 8. Has blunders (good sign)
    const blunderCount = (agg.cls.blunder || 0) + (agg.cls.miss || 0) + (agg.cls.mistake || 0);
    if (blunderCount === 0 && agg.totalMoves > 30) {
      checks.push({ status: 'WARN', label: 'has_mistakes', value: `0 mistakes in ${agg.totalMoves} moves`, threshold: 'expect >0', detail: 'zero mistakes is unusual for humans' });
    } else {
      checks.push({ status: 'PASS', label: 'has_mistakes', value: `${blunderCount} mistakes/blunders`, threshold: '>0', detail: 'humans make mistakes' });
    }

    // Score
    const passCount = checks.filter(c => c.status === 'PASS').length;
    const warnCount = checks.filter(c => c.status === 'WARN').length;
    const failCount = checks.filter(c => c.status === 'FAIL').length;
    const score = passCount * 2 - warnCount - failCount * 3;
    const maxScore = checks.length * 2;
    const humanScore = Math.max(0, Math.min(10, Math.round((score / maxScore) * 10)));
    const risk = humanScore >= 7 ? 'LOW' : humanScore >= 4 ? 'MEDIUM' : 'HIGH';

    log(`\n  --- ${tcLabel} (thresholds for ${tcLabel.toLowerCase()}) ---`);
    for (const c of checks) {
      const tag = c.status === 'PASS' ? '[PASS]' : c.status === 'WARN' ? '[WARN]' : '[FAIL]';
      log(`  ${tag}  ${c.label.padEnd(24)} ${c.value.padEnd(16)} threshold: ${c.threshold.padEnd(10)} ${c.detail}`);
    }
    log();
    log(`  Human Score: ${humanScore}/10  (${passCount} pass, ${warnCount} warn, ${failCount} fail)`);
    log(`  Risk Level:  ${risk}`);
  }

  // Cross-cadence check
  if (isMultiTc) {
    log(`\n  --- Cross-Cadence ---`);
    log(`  avg_delta:      ${avgDelta >= 0 ? '+' : ''}${fmt(avgDelta)}%  — normalized performance vs expected`);
    log(`  delta_stddev:   ${fmt(deltaStdDev)}  — ${deltaStdDev != null && deltaStdDev < 3 ? '[WARN] too consistent across cadences' : '[PASS] normal variation'}`);
  }

  // ─── Game log table ───
  log(`\n${'='.repeat(60)}`);
  log(`  GAME LOG`);
  log(`${'='.repeat(60)}`);
  log(`  ${'#'.padStart(2)}  ${'Acc'.padStart(5)}  ${'Delta'.padStart(6)}  ${'R'.padStart(1)}  ${'TC'.padEnd(4)}  ${'Opponent'.padEnd(16)}  ${'OppRat'.padStart(6)}  ${'Open'.padStart(5)}  ${'Mid'.padStart(5)}  ${'End'.padStart(5)}`);
  log(`  ${'-'.repeat(80)}`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const tc = timeControlLabel(r.tcType).slice(0, 4);
    const d = normalizeAccuracy(r.caps?.all, r.playerRating, r.tcType);
    const dStr = d != null ? `${d >= 0 ? '+' : ''}${fmt(d)}` : '    -';
    log(`  ${String(i + 1).padStart(2)}  ${fmt(r.caps?.all).padStart(5)}  ${dStr.padStart(6)}  ${r.result}  ${tc.padEnd(4)}  ${r.opponentName.padEnd(16).slice(0, 16)}  ${String(r.opponentRating).padStart(6)}  ${fmt(r.caps?.gp0).padStart(5)}  ${fmt(r.caps?.gp1).padStart(5)}  ${fmt(r.caps?.gp2).padStart(5)}`);
  }

  console.log(out);

  // Save report
  const outFile = `playdna-${USERNAME}.txt`;
  writeFileSync(outFile, out);
  console.log(`\n  Report saved to ${outFile}\n`);
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1); });
