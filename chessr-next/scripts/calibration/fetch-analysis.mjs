/**
 * Fetch Chess.com full game analysis by game ID only
 *
 * 1. Fetch game data (moveList) from public API
 * 2. Decode moveList to PGN via python-chess
 * 3. Get auth token (cookies)
 * 4. Send to analysis WebSocket
 * 5. Receive full CAPS analysis
 *
 * Usage: node fetch-analysis.mjs <gameId> [gameType]
 */

import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const { WebSocket } = require('../../serveur/node_modules/ws');

const GAME_ID = process.argv[2];
const GAME_TYPE = process.argv[3] || 'live';

if (!GAME_ID) {
  console.log('Usage: node fetch-analysis.mjs <gameId> [gameType]');
  process.exit(1);
}

// Premium account cookies (chessr-io)
const COOKIES = `PHPSESSID=85d4b629bada2aac71ff3749bc7d151a; ACCESS_TOKEN=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IjU0OGRmOTcwZGEzYzRjMWFkNjAwYTk3NTg3YzIxM2E0MTkwYjNjZWYifQ.eyJhdWQiOiI4ZWVhMDExMC1mOWMxLTExZWYtOWNlNi03ZmQxMjYxMmEzZTMiLCJqdGkiOiJmYmUyMzRjNjc1YTRjZmFlZjQwZWMyOTBlNTYxNzNmODhkMzMzM2UyZTQ2NjI3MzlhNDI0MTQ2OTc0MTcxMWQ0OTQwNzc0NTBhMmU2OGJjNSIsImlhdCI6MTc3NDk0MzEwOS42MDU0NzEsIm5iZiI6MTc3NDk0MzEwOS42MDU0NzMsImV4cCI6MTc3NTAyOTUwOS42MDE3MjMsInN1YiI6ImE1OWE2YTY2LTJhZDYtMTFmMS05MzE1LTgxYzQ3Y2Y0MzZjZCIsInNjb3BlcyI6W10sImxvY2FsZSI6ImVuX1VTIn0.o9W8feE7AKeNq4u81wLgNoVFRSZaC3su4ap3SQkAWkzSXC2f0yxVnsHf7WaLMiuNH64nZ-ORZPx5CnPVBW9935A0WuC1_fnfXbvL7YtOFKtNd9rbv8SUVY0Znt0urIH3LNH1cWTVgQrQS3FXGjgUoqB0nmZevIKn1onk5uwFldcc_AcboOkHbCYeTwtxhDktRC_6IkhxrEzHaJIrq617DyPSIQBMeodPEpggljw_JZth4OOGoLfI2-G0_0uzLAcz8N74-odfiEHzSz_PkPM82YgZysxQKVlE00wkF24cXT2873ZgHxd6EpQCA8_oF3IaIzlZzw4FhQ0OENvFBql_Ew; CHESSCOM_REMEMBERME=Chess.WebBundle.Entity.User%3AY2hlc3NyLWlv%3A1806479109%3AQNo_8rYy9KgjZzfvEd-6J0P5jA_wnJwP5C_lU2MG1Cw~HmRAKEQJsYhucIYyjgIUpPbzcZn_vVC_TN8rC3oVOp4~`;

// ─── Step 1: Fetch game data ───
async function fetchGameData(gameId) {
  console.log(`1. Fetching game data...`);
  const res = await fetch(`https://www.chess.com/callback/live/game/${gameId}?all=true`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Game fetch failed: ${res.status}`);
  const data = await res.json();
  const g = data.game;
  const h = g.pgnHeaders;
  console.log(`   ${h.White} (${h.WhiteElo}) vs ${h.Black} (${h.BlackElo}) — ${h.Result}`);
  console.log(`   ${g.plyCount} plies, ${h.TimeControl}, ECO: ${h.ECO || '?'}`);
  return { moveList: g.moveList, headers: h, plyCount: g.plyCount };
}

// ─── Step 2: Decode moveList to PGN ───
function decodeMoveList(moveList, headers) {
  console.log(`2. Decoding moveList to PGN...`);

  // Chess.com moveList encoding: 2 chars per move
  // a-z = 0-25, A-Z = 26-51, 0-9 = 52-61, ! = 62, ? = 63
  // index → file = index % 8 (a=0..h=7), rank = floor(index/8) + 1
  function charToIdx(ch) {
    const cc = ch.charCodeAt(0);
    if (cc >= 97 && cc <= 122) return cc - 97;       // a-z = 0-25
    if (cc >= 65 && cc <= 90) return cc - 65 + 26;   // A-Z = 26-51
    if (cc >= 48 && cc <= 57) return cc - 48 + 52;   // 0-9 = 52-61
    if (cc === 33) return 62;                          // !
    if (cc === 63) return 63;                          // ?
    return -1;
  }

  function idxToSquare(idx) {
    const file = String.fromCharCode('a'.charCodeAt(0) + (idx % 8));
    const rank = Math.floor(idx / 8) + 1;
    return file + rank;
  }

  const uciMoves = [];
  let i = 0;
  while (i < moveList.length) {
    if (i + 1 >= moveList.length) break;
    const fromIdx = charToIdx(moveList[i]);
    const toIdx = charToIdx(moveList[i + 1]);
    i += 2;
    if (fromIdx < 0 || toIdx < 0) continue;

    const from = idxToSquare(fromIdx);
    const to = idxToSquare(toIdx);
    uciMoves.push(from + to);
  }

  // Convert UCI to SAN + build PGN via python-chess
  const py = `
import chess
import json

uci_moves = json.loads('${JSON.stringify(uciMoves)}')
board = chess.Board()
san_moves = []
for uci in uci_moves:
    try:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            for promo in ['q', 'r', 'b', 'n']:
                pm = chess.Move.from_uci(uci + promo)
                if pm in board.legal_moves:
                    move = pm
                    break
        if move in board.legal_moves:
            san_moves.append(board.san(move))
            board.push(move)
        else:
            break
    except:
        break

# Build PGN move text
pgn_lines = []
for i, san in enumerate(san_moves):
    move_num = i // 2 + 1
    if i % 2 == 0:
        pgn_lines.append(f"{move_num}. {san}")
    else:
        pgn_lines[-1] += f" {san}"

print(" ".join(pgn_lines))
`;

  const sanMoves = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' }).trim();
  console.log(`   Decoded ${uciMoves.length} moves`);
  console.log(`   First moves: ${sanMoves.slice(0, 80)}...`);

  // Build full PGN
  const h = headers;
  const pgnHeaders = [
    `[Event "${h.Event || 'Live Chess'}"]`,
    `[Site "Chess.com"]`,
    `[Date "${h.Date || ''}"]`,
    `[White "${h.White}"]`,
    `[Black "${h.Black}"]`,
    `[Result "${h.Result}"]`,
    `[WhiteElo "${h.WhiteElo}"]`,
    `[BlackElo "${h.BlackElo}"]`,
    `[TimeControl "${h.TimeControl || ''}"]`,
    `[ECO "${h.ECO || ''}"]`,
  ].join('\n');

  return `${pgnHeaders}\n\n${sanMoves} ${h.Result}`;
}

// ─── Step 3: Get auth token ───
async function getToken(gameId, gameType) {
  console.log(`3. Getting analysis token...`);
  const res = await fetch(
    `https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=${gameType}`,
    { headers: { 'Accept': 'application/json', 'Cookie': COOKIES, 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  console.log(`   Token received (${data.token.length} chars)`);
  return data.token;
}

// ─── Step 4: Send to analysis WebSocket ───
function analyzeViaWS(gameId, gameType, token, pgn) {
  console.log(`4. Sending to Chess.com analysis...`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://analysis.chess.com:443/v1/legacy/game-analysis');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout 60s')); }, 60000);
    let lastProgress = 0;

    ws.on('open', () => {
      const request = {
        action: 'gameAnalysis',
        game: { pgn },
        options: {
          caps2: true,
          depth: 18,
          engineType: 'stockfish16 nnue',
          source: {
            gameId, gameType, token,
            client: 'web',
            gameUuid: '',
            product: 'game review',
            userTimeZone: 'Europe/Paris',
          },
          strength: 'Fast',
          tep: {
            ceeDebug: false,
            classificationv3: true,
            nullMoveRepresentation: '--',
            basicVariationThemes: false,
            speechv3: true,
            lang: 'en_US',
            coachLocale: 'en-US',
            coachTextId: 'Generic_coach',
          },
        },
      };
      ws.send(JSON.stringify(request));
      process.stdout.write('   Analyzing: ');
    });

    ws.on('message', (data) => {
      const text = data.toString();
      try {
        const msg = JSON.parse(text);

        if (msg.action === 'progress') {
          const pct = Math.round(msg.progress * 100);
          if (pct >= lastProgress + 10) {
            process.stdout.write(`${pct}% `);
            lastProgress = pct;
          }
          return;
        }

        if (msg.action === 'error') {
          clearTimeout(timeout); ws.close();
          reject(new Error(msg.message));
          return;
        }

        if (msg.action === 'analyzeGame' && msg.data) {
          console.log('done!');
          clearTimeout(timeout); ws.close();
          resolve(msg.data);
          return;
        }

        if (msg.action === 'done') return;
      } catch {}
    });

    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    ws.on('close', () => {});
  });
}

// ─── Main ───
async function main() {
  console.log(`\n=== Chess.com Analysis Fetcher ===`);
  console.log(`Game ID: ${GAME_ID} (${GAME_TYPE})\n`);

  const start = performance.now();

  const gameData = await fetchGameData(GAME_ID);
  const pgnArg = process.argv[4];
  let pgn;
  if (pgnArg) {
    // Use provided PGN with game headers
    const h = gameData.headers;
    const pgnHeaders = [
      `[Event "${h.Event || 'Live Chess'}"]`,
      `[Site "Chess.com"]`,
      `[Date "${h.Date || ''}"]`,
      `[White "${h.White}"]`,
      `[Black "${h.Black}"]`,
      `[Result "${h.Result}"]`,
      `[WhiteElo "${h.WhiteElo}"]`,
      `[BlackElo "${h.BlackElo}"]`,
      `[TimeControl "${h.TimeControl || ''}"]`,
      `[ECO "${h.ECO || ''}"]`,
    ].join('\n');
    pgn = `${pgnHeaders}\n\n${pgnArg}`;
    console.log(`2. Using provided PGN (${pgn.length} chars)`);
  } else {
    pgn = decodeMoveList(gameData.moveList, gameData.headers);
  }
  const token = await getToken(GAME_ID, GAME_TYPE);
  const analysis = await analyzeViaWS(GAME_ID, GAME_TYPE, token, pgn);

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);

  console.log(`\n=== Results (${elapsed}s) ===\n`);
  console.log(`White CAPS: ${analysis.CAPS?.white?.all}`);
  console.log(`Black CAPS: ${analysis.CAPS?.black?.all}`);
  console.log(`Engine: ${analysis.analysisEngine}`);
  console.log(`Book: ${analysis.book?.name} (ply ${analysis.bookPly})`);
  console.log(`Positions: ${analysis.positions?.length}`);
  console.log(`Avg diff: W=${analysis.avgDifference?.white} B=${analysis.avgDifference?.black}`);

  // Save full analysis to file
  const outFile = `chesscom-analysis-${GAME_ID}.json`;
  const { writeFileSync } = await import('fs');
  writeFileSync(outFile, JSON.stringify(analysis, null, 2));
  console.log(`\nFull analysis saved to ${outFile}`);
}

main().catch(e => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
