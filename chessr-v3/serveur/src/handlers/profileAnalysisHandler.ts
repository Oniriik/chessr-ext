/**
 * profileAnalysisHandler — analyzes the last N live games of a Chess.com
 * player. Fetches archives → decodes moveList → drives chess.com's own
 * analysis WebSocket → streams progress back to the calling client →
 * persists the raw result rows.
 *
 * Ported from chessr-next/serveur/src/handlers/profileAnalysisHandler.ts
 * for the chessr.io app's profile-analysis flow. Adaptations vs v2:
 *
 *   - WS type swapped from `ws.WebSocket` to Hono's `WSContext` (the
 *     v3 serveur upgrades via @hono/node-ws). The .send(...) surface
 *     matches; we only re-broadcast strings.
 *   - Supabase singleton imported from `../lib/supabase.js`.
 *   - user_activity write goes through `insertUserActivity` so it
 *     lands in local-pg under USE_LOCAL_DB=true (matches chesscom
 *     review).
 *   - The outbound chess.com analysis WebSocket still uses the `ws`
 *     package (Node-side outbound connection).
 *
 * `profile_analyses` itself stays on Supabase — it's a small app-owned
 * table with per-user rows tracking pending/analyzing/success/error
 * state. The app inserts the pending row via /api/profile-analysis and
 * the WS handler drives it through the rest of the lifecycle.
 */

import type { WSContext } from 'hono/ws';
import { Chess } from 'chess.js';
import { WebSocket } from 'ws';
import { supabase } from '../lib/supabase.js';
import { insertUserActivity, countUserActivityToday } from '../lib/analyticsRepo.js';

const REMEMBERME_COOKIE = `CHESSCOM_REMEMBERME=${process.env.CHESSCOM_REMEMBERME || ''}`;
const MAX_GAMES = 10;
const WEEKLY_LIMIT = 3;

// ─── In-memory subscriber tracking ──────────────────────────────────────

const analysisSubscribers = new Map<string, Set<WSContext>>();
const activeAnalyses = new Set<string>();

function addSubscriber(analysisId: string, ws: WSContext) {
  if (!analysisSubscribers.has(analysisId)) {
    analysisSubscribers.set(analysisId, new Set());
  }
  analysisSubscribers.get(analysisId)!.add(ws);
}

function removeSubscriber(ws: WSContext) {
  for (const [id, subs] of analysisSubscribers) {
    subs.delete(ws);
    if (subs.size === 0) analysisSubscribers.delete(id);
  }
}

function broadcast(analysisId: string, msg: Record<string, unknown>) {
  const subs = analysisSubscribers.get(analysisId);
  if (!subs) return;
  const data = JSON.stringify(msg);
  for (const ws of subs) {
    try { ws.send(data); } catch { /* socket dropped — ignore, next tick prunes */ }
  }
}

// ─── Chess.com helpers ──────────────────────────────────────────────────

function charToSquareIdx(ch: string): number {
  const cc = ch.charCodeAt(0);
  if (cc >= 97 && cc <= 122) return cc - 97;
  if (cc >= 65 && cc <= 90) return cc - 65 + 26;
  if (cc >= 48 && cc <= 57) return cc - 48 + 52;
  if (cc === 33) return 62;
  if (cc === 63) return 63;
  return -1;
}

function idxToSquare(idx: number): string {
  return String.fromCharCode(97 + (idx % 8)) + (Math.floor(idx / 8) + 1);
}

function decodeMoveListToPGN(moveList: string, headers: Record<string, string>): string {
  const uciMoves: string[] = [];
  for (let i = 0; i + 1 < moveList.length; i += 2) {
    const fi = charToSquareIdx(moveList[i]);
    const ti = charToSquareIdx(moveList[i + 1]);
    if (fi < 0 || ti < 0) continue;
    uciMoves.push(idxToSquare(fi) + idxToSquare(ti));
  }

  const chess = new Chess();
  const sanMoves: string[] = [];
  for (const uci of uciMoves) {
    try {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      let move = chess.move({ from, to });
      if (!move) {
        for (const promo of ['q', 'r', 'b', 'n'] as const) {
          move = chess.move({ from, to, promotion: promo });
          if (move) break;
        }
      }
      if (move) sanMoves.push(move.san);
      else break;
    } catch { break; }
  }

  const lines: string[] = [];
  for (let i = 0; i < sanMoves.length; i++) {
    const moveNum = Math.floor(i / 2) + 1;
    if (i % 2 === 0) lines.push(`${moveNum}. ${sanMoves[i]}`);
    else lines[lines.length - 1] += ` ${sanMoves[i]}`;
  }

  const pgnHeaders = [
    `[Event "${headers.Event || 'Live Chess'}"]`,
    `[Site "Chess.com"]`,
    `[Date "${headers.Date || ''}"]`,
    `[White "${headers.White || ''}"]`,
    `[Black "${headers.Black || ''}"]`,
    `[Result "${headers.Result || '*'}"]`,
    `[WhiteElo "${headers.WhiteElo || ''}"]`,
    `[BlackElo "${headers.BlackElo || ''}"]`,
    `[TimeControl "${headers.TimeControl || ''}"]`,
    `[ECO "${headers.ECO || ''}"]`,
  ].join('\n');

  return `${pgnHeaders}\n\n${lines.join(' ')} ${headers.Result || '*'}`;
}

async function fetchGameData(gameId: string) {
  const res = await fetch(
    `https://www.chess.com/callback/live/game/${gameId}?all=true`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Failed to fetch game ${gameId}: ${res.status}`);
  const data = await res.json() as { game?: { moveList?: string; pgnHeaders?: Record<string, string>; plyCount?: number } };
  return {
    moveList: data.game?.moveList || '',
    headers: (data.game?.pgnHeaders || {}) as Record<string, string>,
    plyCount: data.game?.plyCount || 0,
  };
}

async function getAnalysisToken(gameId: string, gameType: string): Promise<string> {
  const res = await fetch(
    `https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=${gameType}`,
    { headers: { Accept: 'application/json', Cookie: REMEMBERME_COOKIE, 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!res.ok) throw new Error(`Auth failed (${res.status})`);
  const data = await res.json() as { token?: string };
  if (!data.token) throw new Error('No token in response');
  return data.token;
}

function fetchAnalysisFromChessCom(
  gameId: string, gameType: string, token: string, pgn: string,
  onProgress?: (progress: number) => void,
): Promise<{ positions?: unknown[]; CAPS?: unknown; reportCard?: unknown; bookPly?: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://analysis.chess.com:443/v1/legacy/game-analysis');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout 60s')); }, 60_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        action: 'gameAnalysis',
        game: { pgn },
        options: {
          caps2: true, depth: 18, engineType: 'stockfish16 nnue', strength: 'Fast',
          source: { gameId, gameType, token, client: 'web', gameUuid: '', product: 'game review', userTimeZone: 'UTC' },
          tep: { ceeDebug: false, classificationv3: true, nullMoveRepresentation: '--', basicVariationThemes: false, speechv3: true, lang: 'en_US', coachLocale: 'en-US', coachTextId: 'Generic_coach', userColor: 'white' },
        },
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'progress' && onProgress) { onProgress(msg.progress); return; }
        if (msg.action === 'error') { clearTimeout(timeout); ws.close(); reject(new Error(msg.message)); return; }
        if (msg.action === 'analyzeGame' && msg.data) { clearTimeout(timeout); ws.close(); resolve(msg.data); return; }
      } catch { /* ignore */ }
    });

    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface ProfileAnalysisStartMessage {
  type: 'profile_analysis_start';
  platformUsername: string;
  analysisId: string;
  gamesCount?: number;
  modes?: string[];
  gamesPerMode?: number;
}

export interface ProfileAnalysisSubscribeMessage {
  type: 'profile_analysis_subscribe';
  analysisId: string;
}

interface GameRawData {
  gameId: string;
  playerColor: 'white' | 'black';
  playerRating: number;
  opponentName: string;
  opponentRating: number;
  result: 'W' | 'L' | 'D';
  timeControl: string;
  publicPgn: string;
  caps: Record<string, unknown>;
  reportCard: Record<string, unknown> | null;
  positions: unknown[];
  bookPly: number;
  whiteName: string;
  blackName: string;
}

// ─── Main handler ───────────────────────────────────────────────────────

export async function handleProfileAnalysis(
  message: ProfileAnalysisStartMessage,
  clientWs: WSContext,
  userId: string,
): Promise<void> {
  const { platformUsername, analysisId, gamesCount: requestedGames, modes: requestedModes, gamesPerMode } = message;
  const send = (msg: Record<string, unknown>) => clientWs.send(JSON.stringify(msg));

  if (!process.env.CHESSCOM_REMEMBERME) {
    send({ type: 'profile_analysis_error', analysisId, error: 'Chess.com not configured' });
    return;
  }

  // Row must exist and belong to the caller.
  const { data: row } = await supabase
    .from('profile_analyses')
    .select('id, status, user_id')
    .eq('id', analysisId)
    .single();

  if (!row || row.user_id !== userId) {
    send({ type: 'profile_analysis_error', analysisId, error: 'Analysis not found' });
    return;
  }
  if (row.status !== 'pending') {
    send({ type: 'profile_analysis_error', analysisId, error: `Analysis already ${row.status}` });
    return;
  }
  if (activeAnalyses.has(userId)) {
    send({ type: 'profile_analysis_error', analysisId, error: 'Another analysis is already running' });
    return;
  }

  // Weekly free-tier limit. Counted off `event_type='profile_analysis'`
  // rows in user_activity from the last 7 days. We use a one-shot SQL
  // count via analyticsRepo so it routes through USE_LOCAL_DB.
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();
  const plan = userSettings?.plan || 'free';
  const isPremium = ['premium', 'lifetime', 'beta', 'freetrial'].includes(plan);

  if (!isPremium) {
    // countUserActivityToday only covers "today" — the v2 used a 7-day
    // window. Approximate by querying user_activity directly for the
    // weekly window. Keeps the logic simple while we settle on a
    // unified limits API.
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { count } = await supabase
      .from('user_activity')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type', 'profile_analysis')
      .gte('created_at', weekAgo.toISOString());
    const weeklyUsage = count || 0;
    if (weeklyUsage >= WEEKLY_LIMIT) {
      await supabase.from('profile_analyses').update({
        status: 'error',
        error_message: 'Weekly limit reached',
      }).eq('id', analysisId);
      send({
        type: 'profile_analysis_error',
        analysisId,
        error: 'weekly_limit',
        weeklyUsage,
        weeklyLimit: WEEKLY_LIMIT,
      });
      return;
    }
  }

  const validModes = ['bullet', 'blitz', 'rapid'];
  const useModeBased = Array.isArray(requestedModes) && requestedModes.length > 0;
  const modes = useModeBased ? requestedModes.filter((m) => validModes.includes(m)) : [];
  const perMode = useModeBased ? Math.min(Math.max(gamesPerMode || 10, 1), 30) : 0;
  const legacyMax = !useModeBased ? Math.min(Math.max(requestedGames || MAX_GAMES, 1), 30) : 0;

  await supabase.from('profile_analyses').update({ status: 'analyzing' }).eq('id', analysisId);
  activeAnalyses.add(userId);
  addSubscriber(analysisId, clientWs);

  try {
    broadcast(analysisId, { type: 'profile_analysis_progress', analysisId, step: 'fetching_history', detail: `Fetching game history for ${platformUsername}...` });

    const archRes = await fetch(
      `https://api.chess.com/pub/player/${platformUsername}/games/archives`,
      { headers: { 'User-Agent': 'Chessr/1.0' } },
    );
    if (!archRes.ok) throw new Error(`Player ${platformUsername} not found`);
    const archives = (((await archRes.json()) as { archives?: string[] }).archives || []) as string[];

    type ChessComGame = { url?: string; time_class?: string; time_control?: string; pgn?: string;
                          white?: { username?: string; rating?: number; result?: string; avatar?: string };
                          black?: { username?: string; rating?: number; result?: string; avatar?: string };
                          _mode?: string; _modeGames?: number; _modeIndex?: number };
    let orderedGames: ChessComGame[];

    if (useModeBased) {
      const modeGames = new Map<string, ChessComGame[]>();
      for (const m of modes) modeGames.set(m, []);

      const startIdx = Math.max(0, archives.length - 12);
      for (let i = archives.length - 1; i >= startIdx; i--) {
        const allFull = modes.every((m) => (modeGames.get(m)?.length || 0) >= perMode);
        if (allFull) break;

        const gRes = await fetch(archives[i], { headers: { 'User-Agent': 'Chessr/1.0' } });
        const gData = (await gRes.json()) as { games?: ChessComGame[] };
        const liveGames = (gData.games || []).filter((g) => g.url?.includes('/live/')).reverse();

        for (const g of liveGames) {
          const tc = g.time_class as string;
          if (!modes.includes(tc)) continue;
          const bucket = modeGames.get(tc)!;
          if (bucket.length >= perMode) continue;
          bucket.push(g);
        }

        if (i % 3 === 0) {
          const counts = modes.map((m) => `${modeGames.get(m)?.length || 0} ${m}`).join(', ');
          broadcast(analysisId, {
            type: 'profile_analysis_progress', analysisId, step: 'fetching_history',
            detail: `Scanning archives... ${counts}`,
          });
        }
      }

      const modeCounts = modes.map((m) => ({ mode: m, count: modeGames.get(m)?.length || 0 }));
      const totalGames = modeCounts.reduce((s, mc) => s + mc.count, 0);
      broadcast(analysisId, {
        type: 'profile_analysis_progress', analysisId, step: 'games_found_by_mode',
        detail: modeCounts.map((mc) => `${mc.count} ${mc.mode}`).join(', '),
        modes: modeCounts, totalGames,
      });
      if (totalGames === 0) throw new Error('No live games found for selected modes');

      orderedGames = [];
      for (const m of modes) {
        const bucket = modeGames.get(m) || [];
        for (const g of bucket) {
          g._mode = m;
          g._modeGames = bucket.length;
          g._modeIndex = orderedGames.filter((og) => og._mode === m).length;
          orderedGames.push(g);
        }
      }
    } else {
      let allGames: ChessComGame[] = [];
      for (let i = archives.length - 1; i >= 0 && allGames.length < legacyMax; i--) {
        const gRes = await fetch(archives[i], { headers: { 'User-Agent': 'Chessr/1.0' } });
        const gData = (await gRes.json()) as { games?: ChessComGame[] };
        const liveGames = (gData.games || []).filter((g) => g.url?.includes('/live/'));
        allGames = [...liveGames, ...allGames];
      }
      orderedGames = allGames.slice(-legacyMax);

      broadcast(analysisId, {
        type: 'profile_analysis_progress', analysisId, step: 'games_found',
        detail: `Found ${orderedGames.length} games`, totalGames: orderedGames.length,
      });
      if (orderedGames.length === 0) throw new Error('No live games found');
    }

    // Per-game analysis.
    const gamesData: GameRawData[] = [];
    let currentMode: string | null = null;
    let modeIdx = 0;

    for (let gi = 0; gi < orderedGames.length; gi++) {
      const g = orderedGames[gi];
      const gameMode = g._mode;
      const gameModeGames = g._modeGames;
      const gameModeIndex = g._modeIndex;

      if (useModeBased && gameMode && gameMode !== currentMode) {
        broadcast(analysisId, {
          type: 'profile_analysis_progress', analysisId, step: 'mode_start',
          mode: gameMode, modeIndex: modeIdx, totalModes: modes.length,
          gamesInMode: gameModeGames,
        });
        currentMode = gameMode;
        modeIdx++;
      }

      const id = g.url?.split('/').pop();
      if (!id) continue;
      const isWhite = g.white?.username?.toLowerCase() === platformUsername.toLowerCase();
      const playerColor: 'white' | 'black' = isWhite ? 'white' : 'black';
      const whiteName = g.white?.username || '';
      const blackName = g.black?.username || '';
      const opponentName = isWhite ? blackName : whiteName;
      const playerRating = (isWhite ? g.white?.rating : g.black?.rating) ?? 0;
      const opponentRating = (isWhite ? g.black?.rating : g.white?.rating) ?? 0;
      const result: 'W' | 'L' | 'D' = isWhite
        ? (g.white?.result === 'win' ? 'W' : g.black?.result === 'win' ? 'L' : 'D')
        : (g.black?.result === 'win' ? 'W' : g.white?.result === 'win' ? 'L' : 'D');

      const opponentAvatar = (isWhite ? g.black?.avatar : g.white?.avatar)
        || 'https://www.chess.com/bundles/web/images/noavatar_l.84a92436.gif';
      const timeClass = g.time_class || '';

      broadcast(analysisId, {
        type: 'profile_analysis_progress', analysisId, step: 'analyzing_game',
        detail: `Analyzing ${gi + 1}/${orderedGames.length}`,
        gameIndex: gi, totalGames: orderedGames.length,
        gameWhite: whiteName, gameBlack: blackName,
        opponentName, opponentAvatar, opponentRating,
        playerColor, result, timeClass,
        ...(useModeBased && gameMode ? { mode: gameMode, gameIndexInMode: gameModeIndex, gamesInMode: gameModeGames } : {}),
      });

      try {
        const gameData = await fetchGameData(id);
        const pgn = decodeMoveListToPGN(gameData.moveList, gameData.headers);
        const token = await getAnalysisToken(id, 'live');

        const analysis = await fetchAnalysisFromChessCom(id, 'live', token, pgn, (progress) => {
          broadcast(analysisId, {
            type: 'profile_analysis_progress', analysisId, step: 'analyzing_game',
            detail: `Analyzing ${gi + 1}/${orderedGames.length}`,
            gameIndex: gi, totalGames: orderedGames.length,
            gameWhite: whiteName, gameBlack: blackName,
            gameProgress: Math.round(progress * 100),
            ...(useModeBased && gameMode ? { mode: gameMode, gameIndexInMode: gameModeIndex, gamesInMode: gameModeGames } : {}),
          });
        });

        const positions = ((analysis.positions || []) as Array<{
          color?: string; classificationName?: string; bestMove?: { isPositionCritical?: boolean }; difference?: number;
        }>).map((pos) => ({
          color: pos.color,
          classificationName: pos.classificationName,
          isPositionCritical: pos.bestMove?.isPositionCritical || false,
          difference: pos.difference,
        }));

        gamesData.push({
          gameId: id,
          playerColor,
          playerRating, opponentName, opponentRating, result,
          timeControl: g.time_control || '',
          publicPgn: g.pgn || '',
          caps: (analysis.CAPS || {}) as Record<string, unknown>,
          reportCard: (analysis.reportCard || null) as Record<string, unknown> | null,
          positions,
          bookPly: analysis.bookPly || 0,
          whiteName, blackName,
        });
      } catch (err) {
        console.error(`[profile-analysis] game ${id} failed:`, (err as Error).message || err);
      }
    }

    if (gamesData.length === 0) throw new Error('All game analyses failed');

    await supabase.from('profile_analyses').update({
      status: 'success',
      games_data: gamesData,
      games_count: gamesData.length,
      completed_at: new Date().toISOString(),
    }).eq('id', analysisId);

    // Activity log for weekly limit tracking. Goes through analyticsRepo
    // so it lands in local-pg when USE_LOCAL_DB=true.
    try {
      await insertUserActivity({
        userId,
        eventType: 'profile_analysis',
        metadata: { analysisId, platformUsername, gamesCount: gamesData.length },
      });
    } catch (err) {
      console.error('[profile-analysis] user_activity insert failed:', err);
    }

    broadcast(analysisId, { type: 'profile_analysis_result', analysisId, gamesData });
    console.info(`[profile-analysis] ${analysisId}: ${gamesData.length} games analyzed for ${platformUsername}`);
  } catch (error) {
    console.error(`[profile-analysis] ${analysisId} failed:`, (error as Error).message || error);
    await supabase.from('profile_analyses').update({
      status: 'error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', analysisId);
    broadcast(analysisId, {
      type: 'profile_analysis_error', analysisId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    activeAnalyses.delete(userId);
    analysisSubscribers.delete(analysisId);
  }
}

// ─── Subscribe handler (reconnection / status check) ────────────────────

export async function handleProfileAnalysisSubscribe(
  message: ProfileAnalysisSubscribeMessage,
  clientWs: WSContext,
  userId: string,
): Promise<void> {
  const { analysisId } = message;
  const send = (msg: Record<string, unknown>) => clientWs.send(JSON.stringify(msg));

  const { data: row } = await supabase
    .from('profile_analyses')
    .select('id, status, user_id, games_data, error_message')
    .eq('id', analysisId)
    .single();

  if (!row || row.user_id !== userId) {
    send({ type: 'profile_analysis_error', analysisId, error: 'Analysis not found' });
    return;
  }

  switch (row.status) {
    case 'success':
      send({ type: 'profile_analysis_result', analysisId, gamesData: row.games_data });
      break;
    case 'analyzing':
      if (analysisSubscribers.has(analysisId)) {
        addSubscriber(analysisId, clientWs);
        send({
          type: 'profile_analysis_progress', analysisId, step: 'analyzing_game',
          detail: 'Analysis in progress...',
        });
      } else {
        // Server restarted mid-analysis — flip the row to error so the
        // client can prompt a retry instead of hanging on "in progress".
        await supabase.from('profile_analyses').update({
          status: 'error',
          error_message: 'Analysis interrupted, please retry',
        }).eq('id', analysisId);
        send({ type: 'profile_analysis_error', analysisId, error: 'Analysis interrupted, please retry' });
      }
      break;
    case 'error':
      send({ type: 'profile_analysis_error', analysisId, error: row.error_message || 'Unknown error' });
      break;
    case 'pending':
      send({ type: 'profile_analysis_error', analysisId, error: 'Analysis not started yet' });
      break;
  }
}

// ─── Disconnect cleanup — called from the WS onClose handler ────────────

export function handleProfileAnalysisDisconnect(ws: WSContext): void {
  removeSubscriber(ws);
}

// Reference an unused export to keep the linter happy until callers
// adopt countUserActivityToday for the weekly path.
void countUserActivityToday;
