/**
 * chesscomReview — Fetches full game analysis from Chess.com's API
 *
 * Uses the Premium account's CHESSCOM_REMEMBERME cookie to:
 * 1. Fetch game data (moveList) from Chess.com public API
 * 2. Decode moveList to PGN
 * 3. Get analysis auth token
 * 4. Connect to Chess.com analysis WebSocket
 * 5. Return full CAPS analysis with classifications, coach speech, etc.
 */

import { WebSocket } from 'ws';
import { Chess } from 'chess.js';
import { supabase } from '../lib/supabase.js';

const REMEMBERME_COOKIE = `CHESSCOM_REMEMBERME=${process.env.CHESSCOM_REMEMBERME || ''}`;
const DAILY_LIMIT = 5;

// ─── MoveList decoder ───
// Chess.com encoding: a-z=0-25, A-Z=26-51, 0-9=52-61, !=62, ?=63

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

// ─── Fetch game data ───

async function fetchGameData(gameId: string): Promise<{
  moveList: string;
  headers: Record<string, string>;
  plyCount: number;
}> {
  const res = await fetch(
    `https://www.chess.com/callback/live/game/${gameId}?all=true`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Failed to fetch game ${gameId}: ${res.status}`);
  const data = await res.json();
  return {
    moveList: data.game?.moveList || '',
    headers: data.game?.pgnHeaders || {},
    plyCount: data.game?.plyCount || 0,
  };
}

// ─── Get analysis token ───

async function getAnalysisToken(gameId: string, gameType: string): Promise<string> {
  const res = await fetch(
    `https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=${gameType}`,
    {
      headers: {
        Accept: 'application/json',
        Cookie: REMEMBERME_COOKIE,
        'User-Agent': 'Mozilla/5.0',
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('No token in response');
  return data.token;
}

// ─── Fetch analysis via Chess.com WebSocket ───

function fetchAnalysisFromChessCom(
  gameId: string,
  gameType: string,
  token: string,
  pgn: string,
  coachId: string,
  userColor: string,
  onProgress?: (progress: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://analysis.chess.com:443/v1/legacy/game-analysis');
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Chess.com analysis timeout (60s)')); }, 60000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        action: 'gameAnalysis',
        game: { pgn },
        options: {
          caps2: true,
          depth: 18,
          engineType: 'stockfish16 nnue',
          strength: 'Fast',
          source: { gameId, gameType, token, client: 'web', gameUuid: '', product: 'game review', userTimeZone: 'UTC' },
          tep: {
            ceeDebug: false, classificationv3: true, nullMoveRepresentation: '--',
            basicVariationThemes: false, speechv3: true, lang: 'en_US',
            coachLocale: 'en-US', coachTextId: coachId, userColor,
          },
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

export interface ReviewMessage {
  type: 'chesscom_review';
  requestId: string;
  gameId: string;
  gameType?: string;
  coachId?: string;
  userColor?: string;
  cacheOnly?: boolean;
}

type SendFn = (data: Record<string, unknown>) => void;

// ─── Public handler ───

export async function handleChesscomReview(
  message: ReviewMessage,
  send: SendFn,
  userId?: string,
): Promise<void> {
  const { requestId, gameId, gameType = 'live', coachId = 'David_coach', userColor = 'white', cacheOnly = false } = message;

  if (!gameId) {
    send({ type: 'chesscom_review_error', requestId, error: 'Missing gameId' });
    return;
  }

  try {
    // Step 1: Check cache
    const { data: cached } = await supabase
      .from('game_reviews')
      .select('analysis, white_username, black_username')
      .eq('game_id', gameId)
      .eq('platform', 'chesscom')
      .eq('coach_id', coachId)
      .single();

    if (cached?.analysis) {
      console.log(`[Review] Cache hit: ${gameId}`);
      send({
        type: 'chesscom_review_result',
        requestId,
        analysis: cached.analysis,
        headers: {
          White: cached.white_username || null,
          Black: cached.black_username || null,
        },
      });
      return;
    }

    // Cache-only mode: just return miss, don't run analysis
    if (cacheOnly) {
      send({ type: 'chesscom_review_cache_miss', requestId });
      return;
    }

    if (!process.env.CHESSCOM_REMEMBERME) {
      send({ type: 'chesscom_review_error', requestId, error: 'Chess.com review not configured' });
      return;
    }

    // Step 2: Check daily limit for free users
    if (userId) {
      const { data: userSettings } = await supabase
        .from('user_settings')
        .select('plan')
        .eq('user_id', userId)
        .single();

      const plan = userSettings?.plan || 'free';
      const isPremium = plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';

      if (!isPremium) {
        const todayUTC = new Date();
        todayUTC.setUTCHours(0, 0, 0, 0);

        const { count } = await supabase
          .from('user_activity')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('event_type', 'game_review')
          .gte('created_at', todayUTC.toISOString());

        const dailyUsage = count || 0;
        if (dailyUsage >= DAILY_LIMIT) {
          console.log(`[Review] Daily limit: ${userId} (${dailyUsage}/${DAILY_LIMIT})`);
          send({ type: 'chesscom_review_error', requestId, error: 'daily_limit', dailyUsage, dailyLimit: DAILY_LIMIT });
          return;
        }
      }
    }

    // Step 3: Fetch game data & decode
    send({ type: 'chesscom_review_progress', requestId, progress: 5 });
    const gameData = await fetchGameData(gameId);
    const pgn = decodeMoveListToPGN(gameData.moveList, gameData.headers);

    // Step 4: Get analysis token
    send({ type: 'chesscom_review_progress', requestId, progress: 10 });
    const token = await getAnalysisToken(gameId, gameType);

    // Step 5: Run analysis with progress
    const analysis = await fetchAnalysisFromChessCom(
      gameId, gameType, token, pgn, coachId, userColor,
      (progress) => {
        send({ type: 'chesscom_review_progress', requestId, progress: 10 + Math.round(progress * 85) });
      },
    );

    // Step 6: Cache in DB
    const analysisData = analysis as Record<string, unknown>;
    const caps = analysisData.CAPS as Record<string, Record<string, number>> | undefined;
    try {
      await supabase.from('game_reviews').upsert({
        game_id: gameId,
        platform: 'chesscom',
        coach_id: coachId,
        analysis,
        caps_white: caps?.white?.all ?? null,
        caps_black: caps?.black?.all ?? null,
        white_username: gameData.headers.White || null,
        black_username: gameData.headers.Black || null,
      }, { onConflict: 'game_id,platform,coach_id' });
    } catch (err) {
      console.error('[Review] Cache failed:', (err as Error).message);
    }

    // Step 7: Log activity
    if (userId) {
      try {
        await supabase.from('user_activity').insert({ user_id: userId, event_type: 'game_review' });
      } catch { /* ignore */ }
    }

    // Step 8: Send result
    console.log(`[Review] Done: ${gameId} (${gameData.headers.White} vs ${gameData.headers.Black})`);
    send({
      type: 'chesscom_review_result',
      requestId,
      analysis,
      headers: {
        White: gameData.headers.White || null,
        Black: gameData.headers.Black || null,
        Result: gameData.headers.Result || null,
      },
    });
  } catch (error) {
    console.error(`[Review] Error: ${gameId}`, error);
    send({ type: 'chesscom_review_error', requestId, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
