/**
 * Analyze last N games of a player via Chess.com API
 * Usage: node analyze-player.mjs <username> [count]
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { WebSocket } = require('../../serveur/node_modules/ws');

const USERNAME = process.argv[2];
const COUNT = parseInt(process.argv[3] || '10');

if (!USERNAME) { console.log('Usage: node analyze-player.mjs <username> [count]'); process.exit(1); }

const COOKIES = `PHPSESSID=85d4b629bada2aac71ff3749bc7d151a; ACCESS_TOKEN=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6IjU0OGRmOTcwZGEzYzRjMWFkNjAwYTk3NTg3YzIxM2E0MTkwYjNjZWYifQ.eyJhdWQiOiI4ZWVhMDExMC1mOWMxLTExZWYtOWNlNi03ZmQxMjYxMmEzZTMiLCJqdGkiOiJmYmUyMzRjNjc1YTRjZmFlZjQwZWMyOTBlNTYxNzNmODhkMzMzM2UyZTQ2NjI3MzlhNDI0MTQ2OTc0MTcxMWQ0OTQwNzc0NTBhMmU2OGJjNSIsImlhdCI6MTc3NDk0MzEwOS42MDU0NzEsIm5iZiI6MTc3NDk0MzEwOS42MDU0NzMsImV4cCI6MTc3NTAyOTUwOS42MDE3MjMsInN1YiI6ImE1OWE2YTY2LTJhZDYtMTFmMS05MzE1LTgxYzQ3Y2Y0MzZjZCIsInNjb3BlcyI6W10sImxvY2FsZSI6ImVuX1VTIn0.o9W8feE7AKeNq4u81wLgNoVFRSZaC3su4ap3SQkAWkzSXC2f0yxVnsHf7WaLMiuNH64nZ-ORZPx5CnPVBW9935A0WuC1_fnfXbvL7YtOFKtNd9rbv8SUVY0Znt0urIH3LNH1cWTVgQrQS3FXGjgUoqB0nmZevIKn1onk5uwFldcc_AcboOkHbCYeTwtxhDktRC_6IkhxrEzHaJIrq617DyPSIQBMeodPEpggljw_JZth4OOGoLfI2-G0_0uzLAcz8N74-odfiEHzSz_PkPM82YgZysxQKVlE00wkF24cXT2873ZgHxd6EpQCA8_oF3IaIzlZzw4FhQ0OENvFBql_Ew; CHESSCOM_REMEMBERME=Chess.WebBundle.Entity.User%3AY2hlc3NyLWlv%3A1806479109%3AQNo_8rYy9KgjZzfvEd-6J0P5jA_wnJwP5C_lU2MG1Cw~HmRAKEQJsYhucIYyjgIUpPbzcZn_vVC_TN8rC3oVOp4~`;

// ─── Helpers ───
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

// ─── Main ───
async function main() {
  console.log(`Fetching games for ${USERNAME}...\n`);

  // Get archives
  const archRes = await fetch(`https://api.chess.com/pub/player/${USERNAME}/games/archives`, { headers: { 'User-Agent': 'Chessr/1.0' } });
  const archives = (await archRes.json()).archives || [];

  let allGames = [];
  for (let i = archives.length - 1; i >= 0 && allGames.length < COUNT; i--) {
    const gRes = await fetch(archives[i], { headers: { 'User-Agent': 'Chessr/1.0' } });
    const gData = await gRes.json();
    const liveGames = (gData.games || []).filter(g => g.url?.includes('/live/'));
    allGames = [...liveGames, ...allGames];
  }

  const games = allGames.slice(-COUNT);
  console.log(`Found ${games.length} live games\n`);

  const results = [];

  for (let gi = 0; gi < games.length; gi++) {
    const g = games[gi];
    const id = g.url?.split('/').pop();
    const isWhite = g.white?.username?.toLowerCase() === USERNAME.toLowerCase();
    const playerColor = isWhite ? 'white' : 'black';
    const opponentName = isWhite ? g.black?.username : g.white?.username;
    const playerRating = isWhite ? g.white?.rating : g.black?.rating;
    const opponentRating = isWhite ? g.black?.rating : g.white?.rating;
    const result = isWhite ? (g.white?.result === 'win' ? 'Win' : g.black?.result === 'win' ? 'Loss' : 'Draw') : (g.black?.result === 'win' ? 'Win' : g.white?.result === 'win' ? 'Loss' : 'Draw');

    process.stdout.write(`[${gi + 1}/${games.length}] ${g.white?.username} vs ${g.black?.username} (${id})... `);

    try {
      // Get game data for moveList
      const gdRes = await fetch(`https://www.chess.com/callback/live/game/${id}?all=true`, { headers: { 'Accept': 'application/json' } });
      const gdData = await gdRes.json();
      const pgn = decodeMoveList(gdData.game.moveList, gdData.game.pgnHeaders);

      const token = await getToken(id, 'live');
      if (!token) { console.log('no token'); continue; }

      const analysis = await analyzeViaWS(id, 'live', token, pgn);
      console.log(`done (${analysis.CAPS?.[playerColor]?.all})`);

      // Count classifications for both players
      const wCls = {}, bCls = {};
      for (const pos of analysis.positions || []) {
        if (!pos.classificationName) continue;
        if (pos.color === 'white') wCls[pos.classificationName] = (wCls[pos.classificationName] || 0) + 1;
        else if (pos.color === 'black') bCls[pos.classificationName] = (bCls[pos.classificationName] || 0) + 1;
      }

      results.push({
        id, opponent: opponentName, playerRating, opponentRating, result, playerColor,
        accuracy: analysis.CAPS?.[playerColor]?.all,
        opponentAccuracy: analysis.CAPS?.[playerColor === 'white' ? 'black' : 'white']?.all,
        wClassifications: wCls,
        bClassifications: bCls,
        wPhases: { gp0: analysis.CAPS?.white?.gp0, gp1: analysis.CAPS?.white?.gp1, gp2: analysis.CAPS?.white?.gp2 },
        bPhases: { gp0: analysis.CAPS?.black?.gp0, gp1: analysis.CAPS?.black?.gp1, gp2: analysis.CAPS?.black?.gp2 },
        wPieces: analysis.CAPS?.white,
        bPieces: analysis.CAPS?.black,
        book: analysis.book?.name,
        summary: analysis.gameSummary,
      });
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
  }

  // ─── Generate MD report ───
  const clsOrder = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  const clsLabels = { brilliant: 'Brilliant', great: 'Great', best: 'Best', excellent: 'Excellent', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', miss: 'Miss', blunder: 'Blunder' };
  const pieceLabels = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
  const fmt = (v) => v != null ? v.toFixed(1) : '-';
  const pad = (s, n) => String(s).padStart(n);

  let md = `# Game Review Report: ${USERNAME}\n\n`;
  md += `> ${results.length} games analyzed via Chess.com (Stockfish 16.1 NNUE, depth 18)\n\n`;

  // Overall stats
  const accs = results.map(r => r.accuracy).filter(a => a != null);
  const avgAcc = accs.length ? (accs.reduce((a, b) => a + b, 0) / accs.length).toFixed(1) : '-';
  const wins = results.filter(r => r.result === 'Win').length;
  const losses = results.filter(r => r.result === 'Loss').length;
  const draws = results.filter(r => r.result === 'Draw').length;

  md += `## Overall Stats\n\n`;
  md += `| | Value |\n|---|---|\n`;
  md += `| Games | ${results.length} (W: ${wins} / L: ${losses} / D: ${draws}) |\n`;
  md += `| Average Accuracy | ${avgAcc} |\n\n`;

  md += `---\n\n`;

  for (const r of results) {
    const wName = r.playerColor === 'white' ? USERNAME : r.opponent;
    const bName = r.playerColor === 'black' ? USERNAME : r.opponent;
    const wRating = r.playerColor === 'white' ? r.playerRating : r.opponentRating;
    const bRating = r.playerColor === 'black' ? r.playerRating : r.opponentRating;
    const wAcc = r.playerColor === 'white' ? r.accuracy : r.opponentAccuracy;
    const bAcc = r.playerColor === 'black' ? r.accuracy : r.opponentAccuracy;

    md += `## ${wName} vs ${bName} — ${r.result}\n\n`;

    // Accuracy + Game Rating
    md += `### Accuracy\n\n`;
    md += `| | ${wName} (White) | ${bName} (Black) |\n`;
    md += `|---|---|---|\n`;
    md += `| **Accuracy** | **${fmt(r.playerColor === 'white' ? r.accuracy : r.opponentAccuracy)}** | **${fmt(r.playerColor === 'black' ? r.accuracy : r.opponentAccuracy)}** |\n`;
    md += `| Game Rating | ${wRating} | ${bRating} |\n\n`;

    // Move Classifications
    md += `### Move Classifications\n\n`;
    md += `| | ${wName} | ${bName} |\n`;
    md += `|---|---|---|\n`;
    for (const c of clsOrder) {
      const wCount = r.wClassifications?.[c] || 0;
      const bCount = r.bClassifications?.[c] || 0;
      if (wCount > 0 || bCount > 0) {
        md += `| ${clsLabels[c]} | ${wCount} | ${bCount} |\n`;
      }
    }
    md += `\n`;

    // Accuracy by Phase
    md += `### Accuracy by Phase\n\n`;
    md += `| | ${wName} | ${bName} |\n`;
    md += `|---|---|---|\n`;
    md += `| Opening | ${fmt(r.wPhases?.gp0)} | ${fmt(r.bPhases?.gp0)} |\n`;
    md += `| Middlegame | ${fmt(r.wPhases?.gp1)} | ${fmt(r.bPhases?.gp1)} |\n`;
    md += `| Endgame | ${fmt(r.wPhases?.gp2)} | ${fmt(r.bPhases?.gp2)} |\n\n`;

    // Accuracy by Piece
    md += `### Accuracy by Piece\n\n`;
    md += `| | ${wName} | ${bName} |\n`;
    md += `|---|---|---|\n`;
    for (const p of ['K', 'Q', 'R', 'B', 'N', 'P']) {
      const wVal = r.wPieces?.[p];
      const bVal = r.bPieces?.[p];
      if ((wVal && wVal > 0) || (bVal && bVal > 0)) {
        md += `| ${pieceLabels[p]} | ${fmt(wVal)} | ${fmt(bVal)} |\n`;
      }
    }
    md += `\n`;

    // Summary
    if (r.summary) {
      md += `> ${r.summary}\n\n`;
    }

    md += `---\n\n`;
  }

  console.log('\n' + md);

  const outFile = `report-${USERNAME}.md`;
  writeFileSync(outFile, md);
  console.log(`Report saved to ${outFile}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
