/**
 * profileAnalysisHandler - Analyzes last 10 games of a Chess.com player
 *
 * Fetches game archives, runs Chess.com analysis on each game,
 * streams progress via WebSocket, saves raw data to DB.
 * DNA/anti-cheat computation is done client-side.
 */

import type { WebSocket as WS } from 'ws';
import { WebSocket } from 'ws';
import { Chess } from 'chess.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logEnd, logError } from '../utils/logger.js';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const REMEMBERME_COOKIE = `CHESSCOM_REMEMBERME=${process.env.CHESSCOM_REMEMBERME || ''}`;
const MAX_GAMES = 10;

// ─── In-memory subscriber tracking ───
const analysisSubscribers = new Map<string, Set<WS>>();
const activeAnalyses = new Set<string>();

function addSubscriber(analysisId: string, ws: WS) {
  if (!analysisSubscribers.has(analysisId)) {
    analysisSubscribers.set(analysisId, new Set());
  }
  analysisSubscribers.get(analysisId)!.add(ws);
}

function removeSubscriber(ws: WS) {
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
    if (ws.readyState === 1) ws.send(data);
  }
}

// ─── Chess.com helpers (shared with chesscomReviewHandler) ───

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
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`Failed to fetch game ${gameId}: ${res.status}`);
  const data = await res.json();
  return {
    moveList: data.game?.moveList || '',
    headers: data.game?.pgnHeaders || {} as Record<string, string>,
    plyCount: data.game?.plyCount || 0,
  };
}

async function getAnalysisToken(gameId: string, gameType: string): Promise<string> {
  const res = await fetch(
    `https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=${gameType}`,
    { headers: { Accept: 'application/json', Cookie: REMEMBERME_COOKIE, 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) throw new Error(`Auth failed (${res.status})`);
  const data = await res.json();
  if (!data.token) throw new Error('No token in response');
  return data.token;
}

function fetchAnalysisFromChessCom(
  gameId: string, gameType: string, token: string, pgn: string,
  onProgress?: (progress: number) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://analysis.chess.com:443/v1/legacy/game-analysis');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout 60s')); }, 60000);

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

// ─── Types ───

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
  publicPgn: string; // PGN with %clk annotations from Chess.com public API
  caps: Record<string, any>; // CAPS data for both colors
  reportCard: Record<string, any> | null; // effectiveElo per color
  positions: any[]; // position data with classificationName, isPositionCritical
  bookPly: number;
  whiteName: string;
  blackName: string;
}

// ─── Main handler ───

export async function handleProfileAnalysis(
  message: ProfileAnalysisStartMessage,
  clientWs: WS,
  userId: string,
): Promise<void> {
  const { platformUsername, analysisId, gamesCount: requestedGames, modes: requestedModes, gamesPerMode } = message;

  if (!supabase) {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Database not configured' }));
    return;
  }

  if (!process.env.CHESSCOM_REMEMBERME) {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Chess.com not configured' }));
    return;
  }

  // Validate analysis row exists and belongs to user
  const { data: row } = await supabase
    .from('profile_analyses')
    .select('id, status, user_id')
    .eq('id', analysisId)
    .single();

  if (!row || row.user_id !== userId) {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Analysis not found' }));
    return;
  }

  if (row.status !== 'pending') {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: `Analysis already ${row.status}` }));
    return;
  }

  // Check no other analysis is running for this user
  if (activeAnalyses.has(userId)) {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Another analysis is already running' }));
    return;
  }

  // Check weekly limit for free users
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();

  const plan = userSettings?.plan || 'free';
  const isPremium = plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';

  if (!isPremium) {
    const WEEKLY_LIMIT = 3;
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
      // Mark the pending row as error so it doesn't stay stuck
      await supabase.from('profile_analyses').update({
        status: 'error',
        error_message: 'Weekly limit reached',
      }).eq('id', analysisId);

      clientWs.send(JSON.stringify({
        type: 'profile_analysis_error',
        analysisId,
        error: 'weekly_limit',
        weeklyUsage,
        weeklyLimit: WEEKLY_LIMIT,
      }));
      return;
    }
  }

  // Determine mode-by-mode vs legacy behavior
  const validModes = ['bullet', 'blitz', 'rapid'];
  const useModeBased = Array.isArray(requestedModes) && requestedModes.length > 0;
  const modes = useModeBased ? requestedModes.filter(m => validModes.includes(m)) : [];
  const perMode = useModeBased ? Math.min(Math.max(gamesPerMode || 10, 1), 30) : 0;
  const legacyMax = !useModeBased ? Math.min(Math.max(requestedGames || MAX_GAMES, 1), 30) : 0;

  // Mark as analyzing
  await supabase.from('profile_analyses').update({ status: 'analyzing' }).eq('id', analysisId);
  activeAnalyses.add(userId);
  addSubscriber(analysisId, clientWs);

  // logStart is called from index.ts switch case

  try {
    // Step 1: Fetch game archives
    broadcast(analysisId, { type: 'profile_analysis_progress', analysisId, step: 'fetching_history', detail: `Fetching game history for ${platformUsername}...` });

    const archRes = await fetch(
      `https://api.chess.com/pub/player/${platformUsername}/games/archives`,
      { headers: { 'User-Agent': 'Chessr/1.0' } }
    );
    if (!archRes.ok) throw new Error(`Player ${platformUsername} not found`);
    const archives = ((await archRes.json()).archives || []) as string[];

    let orderedGames: any[]; // flat list of games to analyze, in order

    if (useModeBased) {
      // Mode-by-mode: group games by time_class, fill per-mode buckets
      const modeGames = new Map<string, any[]>();
      for (const m of modes) modeGames.set(m, []);

      // Only scan last 12 months of archives
      const startIdx = Math.max(0, archives.length - 12);
      for (let i = archives.length - 1; i >= startIdx; i--) {
        // Check if all mode buckets are full
        const allFull = modes.every(m => (modeGames.get(m)?.length || 0) >= perMode);
        if (allFull) break;

        const gRes = await fetch(archives[i], { headers: { 'User-Agent': 'Chessr/1.0' } });
        const gData = await gRes.json();
        const liveGames = (gData.games || []).filter((g: any) => g.url?.includes('/live/')).reverse(); // newest first

        for (const g of liveGames) {
          const tc = g.time_class as string;
          if (!modes.includes(tc)) continue;
          const bucket = modeGames.get(tc)!;
          if (bucket.length >= perMode) continue;
          bucket.push(g);
        }

        // Progress: show how many found so far while scanning
        if (i % 3 === 0) {
          const counts = modes.map(m => `${modeGames.get(m)?.length || 0} ${m}`).join(', ');
          broadcast(analysisId, {
            type: 'profile_analysis_progress', analysisId, step: 'fetching_history',
            detail: `Scanning archives... ${counts}`,
          });
        }
      }

      // Broadcast per-mode counts
      const modeCounts = modes.map(m => ({ mode: m, count: modeGames.get(m)?.length || 0 }));
      const totalGames = modeCounts.reduce((s, mc) => s + mc.count, 0);

      broadcast(analysisId, {
        type: 'profile_analysis_progress', analysisId, step: 'games_found_by_mode',
        detail: modeCounts.map(mc => `${mc.count} ${mc.mode}`).join(', '),
        modes: modeCounts, totalGames,
      });

      if (totalGames === 0) throw new Error('No live games found for selected modes');

      // Build ordered list: mode by mode
      orderedGames = [];
      for (const m of modes) {
        const bucket = modeGames.get(m) || [];
        for (const g of bucket) {
          (g as any)._mode = m;
          (g as any)._modeGames = bucket.length;
          (g as any)._modeIndex = orderedGames.filter((og: any) => og._mode === m).length;
          orderedGames.push(g);
        }
      }
    } else {
      // Legacy: collect last N live games regardless of mode
      let allGames: any[] = [];
      for (let i = archives.length - 1; i >= 0 && allGames.length < legacyMax; i--) {
        const gRes = await fetch(archives[i], { headers: { 'User-Agent': 'Chessr/1.0' } });
        const gData = await gRes.json();
        const liveGames = (gData.games || []).filter((g: any) => g.url?.includes('/live/'));
        allGames = [...liveGames, ...allGames];
      }
      orderedGames = allGames.slice(-legacyMax);

      broadcast(analysisId, {
        type: 'profile_analysis_progress', analysisId, step: 'games_found',
        detail: `Found ${orderedGames.length} games`, totalGames: orderedGames.length,
      });

      if (orderedGames.length === 0) throw new Error('No live games found');
    }

    // Step 2: Analyze each game (mode by mode if applicable)
    const gamesData: GameRawData[] = [];
    let currentMode: string | null = null;
    let modeIdx = 0;

    for (let gi = 0; gi < orderedGames.length; gi++) {
      const g = orderedGames[gi];
      const gameMode = (g as any)._mode as string | undefined;
      const gameModeGames = (g as any)._modeGames as number | undefined;
      const gameModeIndex = (g as any)._modeIndex as number | undefined;

      // Broadcast mode_start when entering a new mode
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
      const isWhite = g.white?.username?.toLowerCase() === platformUsername.toLowerCase();
      const playerColor = isWhite ? 'white' : 'black';
      const whiteName = g.white?.username || '';
      const blackName = g.black?.username || '';
      const opponentName = isWhite ? blackName : whiteName;
      const playerRating = isWhite ? g.white?.rating : g.black?.rating;
      const opponentRating = isWhite ? g.black?.rating : g.white?.rating;
      const result: 'W' | 'L' | 'D' = isWhite
        ? (g.white?.result === 'win' ? 'W' : g.black?.result === 'win' ? 'L' : 'D')
        : (g.black?.result === 'win' ? 'W' : g.white?.result === 'win' ? 'L' : 'D');

      const opponentAvatar = isWhite
        ? g.black?.avatar || `https://www.chess.com/bundles/web/images/noavatar_l.84a92436.gif`
        : g.white?.avatar || `https://www.chess.com/bundles/web/images/noavatar_l.84a92436.gif`;
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

        const positions = (analysis.positions || []).map((pos: any) => ({
          color: pos.color,
          classificationName: pos.classificationName,
          isPositionCritical: pos.bestMove?.isPositionCritical || false,
          difference: pos.difference,
        }));

        gamesData.push({
          gameId: id,
          playerColor: playerColor as 'white' | 'black',
          playerRating, opponentName, opponentRating, result,
          timeControl: g.time_control || '',
          publicPgn: g.pgn || '',
          caps: analysis.CAPS || {},
          reportCard: analysis.reportCard || null,
          positions,
          bookPly: analysis.bookPly || 0,
          whiteName, blackName,
        });

      } catch (err) {
        console.error(`  [profile-analysis] game ${id} failed:`, (err as Error).message || err);
        // Continue with other games
      }
    }

    if (gamesData.length === 0) throw new Error('All game analyses failed');

    // Step 3: Save to DB and send result
    await supabase.from('profile_analyses').update({
      status: 'success',
      games_data: gamesData,
      games_count: gamesData.length,
      completed_at: new Date().toISOString(),
    }).eq('id', analysisId);

    // Log activity for weekly limit tracking
    await supabase.from('user_activity').insert({
      user_id: userId,
      event_type: 'profile_analysis',
      metadata: { analysisId, platformUsername, gamesCount: gamesData.length },
    });

    broadcast(analysisId, {
      type: 'profile_analysis_result', analysisId, gamesData,
    });

    logEnd({ requestId: analysisId, email: platformUsername, type: 'profile-analysis', result: `${gamesData.length} games analyzed` });

  } catch (error) {
    logError({ requestId: analysisId, email: platformUsername, type: 'profile-analysis', error: error instanceof Error ? error.message : 'Unknown error' });

    if (supabase) {
      await supabase.from('profile_analyses').update({
        status: 'error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      }).eq('id', analysisId);
    }

    broadcast(analysisId, {
      type: 'profile_analysis_error', analysisId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    activeAnalyses.delete(userId);
    analysisSubscribers.delete(analysisId);
  }
}

// ─── Subscribe handler (reconnection) ───

export async function handleProfileAnalysisSubscribe(
  message: ProfileAnalysisSubscribeMessage,
  clientWs: WS,
  userId: string,
): Promise<void> {
  const { analysisId } = message;

  if (!supabase) {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Database not configured' }));
    return;
  }

  const { data: row } = await supabase
    .from('profile_analyses')
    .select('id, status, user_id, games_data, error_message')
    .eq('id', analysisId)
    .single();

  if (!row || row.user_id !== userId) {
    clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Analysis not found' }));
    return;
  }

  switch (row.status) {
    case 'success':
      clientWs.send(JSON.stringify({ type: 'profile_analysis_result', analysisId, gamesData: row.games_data }));
      break;

    case 'analyzing':
      // Add to subscribers if analysis is still running
      if (activeAnalyses.size > 0 && analysisSubscribers.has(analysisId)) {
        addSubscriber(analysisId, clientWs);
        clientWs.send(JSON.stringify({
          type: 'profile_analysis_progress', analysisId, step: 'analyzing_game',
          detail: 'Analysis in progress...',
        }));
      } else {
        // Analysis process died (server restart), mark as error
        await supabase.from('profile_analyses').update({
          status: 'error', error_message: 'Analysis interrupted, please retry',
        }).eq('id', analysisId);
        clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Analysis interrupted, please retry' }));
      }
      break;

    case 'error':
      clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: row.error_message || 'Unknown error' }));
      break;

    case 'pending':
      clientWs.send(JSON.stringify({ type: 'profile_analysis_error', analysisId, error: 'Analysis not started yet' }));
      break;
  }
}

// ─── Disconnect cleanup ───

export function handleProfileAnalysisDisconnect(ws: WS): void {
  removeSubscriber(ws);
}
