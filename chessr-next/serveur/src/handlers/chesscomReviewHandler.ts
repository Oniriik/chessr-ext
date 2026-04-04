/**
 * chesscomReviewHandler - Fetches full game analysis from Chess.com's API
 *
 * Uses the Premium account's CHESSCOM_REMEMBERME cookie to:
 * 1. Fetch game data (moveList) from Chess.com public API
 * 2. Decode moveList to PGN
 * 3. Get analysis auth token
 * 4. Connect to Chess.com analysis WebSocket
 * 5. Return full CAPS analysis with classifications, coach speech, etc.
 */

import type { WebSocket as WS } from 'ws';
import { WebSocket } from 'ws';
import { Chess } from 'chess.js';
import { createClient } from '@supabase/supabase-js';
import { logEnd, logError } from '../utils/logger.js';

// Supabase client for caching reviews
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const REMEMBERME_COOKIE = `CHESSCOM_REMEMBERME=${process.env.CHESSCOM_REMEMBERME || ''}`;

// ─── MoveList decoder ───
// Chess.com encoding: a-z=0-25, A-Z=26-51, 0-9=52-61, !=62, ?=63
// index → file = idx%8 (a=0..h=7), rank = floor(idx/8)+1

function charToSquareIdx(ch: string): number {
  const cc = ch.charCodeAt(0);
  if (cc >= 97 && cc <= 122) return cc - 97;       // a-z
  if (cc >= 65 && cc <= 90) return cc - 65 + 26;   // A-Z
  if (cc >= 48 && cc <= 57) return cc - 48 + 52;   // 0-9
  if (cc === 33) return 62;                          // !
  if (cc === 63) return 63;                          // ?
  return -1;
}

function idxToSquare(idx: number): string {
  return String.fromCharCode(97 + (idx % 8)) + (Math.floor(idx / 8) + 1);
}

function decodeMoveListToPGN(
  moveList: string,
  headers: Record<string, string>
): string {
  // Decode to UCI moves
  const uciMoves: string[] = [];
  for (let i = 0; i + 1 < moveList.length; i += 2) {
    const fi = charToSquareIdx(moveList[i]);
    const ti = charToSquareIdx(moveList[i + 1]);
    if (fi < 0 || ti < 0) continue;
    uciMoves.push(idxToSquare(fi) + idxToSquare(ti));
  }

  // Convert UCI to SAN using chess.js
  const chess = new Chess();
  const sanMoves: string[] = [];

  for (const uci of uciMoves) {
    try {
      // Try the move directly
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);

      let move = chess.move({ from, to });

      // If failed, try with promotion (queen default, then others)
      if (!move) {
        for (const promo of ['q', 'r', 'b', 'n'] as const) {
          move = chess.move({ from, to, promotion: promo });
          if (move) break;
        }
      }

      if (move) {
        sanMoves.push(move.san);
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  // Build PGN string
  const lines: string[] = [];
  for (let i = 0; i < sanMoves.length; i++) {
    const moveNum = Math.floor(i / 2) + 1;
    if (i % 2 === 0) {
      lines.push(`${moveNum}. ${sanMoves[i]}`);
    } else {
      lines[lines.length - 1] += ` ${sanMoves[i]}`;
    }
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

async function fetchGameData(gameId: string, _gameType: string = 'live'): Promise<{
  moveList: string;
  headers: Record<string, string>;
  plyCount: number;
}> {
  // All game types use the live endpoint (computer game IDs are in a different namespace
  // but the analysis token handles the game_type distinction)
  const res = await fetch(
    `https://www.chess.com/callback/live/game/${gameId}?all=true`,
    { headers: { Accept: 'application/json' } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch game ${gameId}: ${res.status}`);
  }

  const data = await res.json();
  return {
    moveList: data.game?.moveList || '',
    headers: data.game?.pgnHeaders || {},
    plyCount: data.game?.plyCount || 0,
  };
}

// ─── Get analysis token ───

async function getAnalysisToken(
  gameId: string,
  gameType: string
): Promise<string> {
  const res = await fetch(
    `https://www.chess.com/callback/auth/service/analysis?game_id=${gameId}&game_type=${gameType}`,
    {
      headers: {
        Accept: 'application/json',
        Cookie: REMEMBERME_COOKIE,
        'User-Agent': 'Mozilla/5.0',
      },
    }
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
  onProgress?: (progress: number) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      'wss://analysis.chess.com:443/v1/legacy/game-analysis'
    );
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Chess.com analysis timeout (60s)'));
    }, 60000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          action: 'gameAnalysis',
          game: { pgn },
          options: {
            caps2: true,
            depth: 18,
            engineType: 'stockfish16 nnue',
            strength: 'Fast',
            source: {
              gameId,
              gameType,
              token,
              client: 'web',
              gameUuid: '',
              product: 'game review',
              userTimeZone: 'UTC',
            },
            tep: {
              ceeDebug: false,
              classificationv3: true,
              nullMoveRepresentation: '--',
              basicVariationThemes: false,
              speechv3: true,
              lang: 'en_US',
              coachLocale: 'en-US',
              coachTextId: coachId,
              userColor,
            },
          },
        })
      );
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.action === 'progress' && onProgress) {
          onProgress(msg.progress);
          return;
        }

        if (msg.action === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.message));
          return;
        }

        if (msg.action === 'analyzeGame' && msg.data) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.data);
          return;
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─── Public handler ───

export async function handleChesscomReview(
  message: { type: string; requestId: string; gameId: string; gameType?: string; coachId?: string; userColor?: string },
  clientWs: WS,
  userId?: string,
  supabaseClient?: ReturnType<typeof import('@supabase/supabase-js').createClient>,
  userEmail?: string,
): Promise<void> {
  const { requestId, gameId, gameType = 'live', coachId = 'David_coach', userColor = 'white' } = message;

  if (!gameId) {
    clientWs.send(
      JSON.stringify({
        type: 'chesscom_review_error',
        requestId,
        error: 'Missing gameId',
      })
    );
    return;
  }

  if (!process.env.CHESSCOM_REMEMBERME) {
    clientWs.send(
      JSON.stringify({
        type: 'chesscom_review_error',
        requestId,
        error: 'Chess.com review not configured',
      })
    );
    return;
  }

  try {
    // Step 0: Check cache in DB first (by game_id + coach_id)
    if (supabase) {
      const { data: cached } = await supabase
        .from('game_reviews')
        .select('analysis')
        .eq('game_id', gameId)
        .eq('platform', 'chesscom')
        .eq('coach_id', coachId)
        .single();

      if (cached?.analysis) {
        logEnd({ requestId: gameId, email: userEmail || gameId, type: 'game-review', result: 'cache hit' });
        if (clientWs.readyState === 1) {
          clientWs.send(JSON.stringify({ type: 'chesscom_review_result', requestId, analysis: cached.analysis }));
        }
        return;
      }
    }

    // Step 0.5: Check daily limit for free users
    if (userId && supabaseClient) {
      const { data: userSettings } = await supabaseClient
        .from('user_settings')
        .select('plan')
        .eq('user_id', userId)
        .single();

      const plan = userSettings?.plan || 'free';
      const isPremium = plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial';

      if (!isPremium) {
        const DAILY_LIMIT = 5;
        const todayUTC = new Date();
        todayUTC.setUTCHours(0, 0, 0, 0);

        const { count } = await supabaseClient
          .from('user_activity')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('event_type', 'game_review')
          .gte('created_at', todayUTC.toISOString());

        const dailyUsage = count || 0;
        if (dailyUsage >= DAILY_LIMIT) {
          logEnd({ requestId: gameId, email: userEmail || gameId, type: 'game-review', result: `daily limit (${dailyUsage}/${DAILY_LIMIT})` });
          if (clientWs.readyState === 1) {
            clientWs.send(JSON.stringify({
              type: 'chesscom_review_error',
              requestId,
              error: 'daily_limit',
              dailyUsage,
              dailyLimit: DAILY_LIMIT,
            }));
          }
          return;
        }
      }
    }

    // Step 1: Fetch game data
    const gameData = await fetchGameData(gameId, gameType);

    // Step 2: Decode moveList to PGN
    const pgn = decodeMoveListToPGN(gameData.moveList, gameData.headers);

    // Step 3: Get analysis token
    const token = await getAnalysisToken(gameId, gameType);

    // Step 4: Fetch analysis from Chess.com
    const analysis = await fetchAnalysisFromChessCom(
      gameId,
      gameType,
      token,
      pgn,
      coachId,
      userColor,
      (progress) => {
        // Stream progress to client
        if (clientWs.readyState === 1) {
          clientWs.send(
            JSON.stringify({
              type: 'chesscom_review_progress',
              requestId,
              progress: Math.round(progress * 100),
            })
          );
        }
      }
    );

    // Analysis received

    // Step 5: Cache in DB
    if (supabase) {
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
        console.error(`  [game-review] cache failed:`, (err as Error).message || err);
      }
    }

    // Step 6: Log activity for daily limit tracking
    if (userId) {
      const { logActivity } = await import('../utils/activityLogger.js');
      logActivity(userId, 'game_review');
    }

    // Step 7: Send full result
    if (clientWs.readyState === 1) {
      clientWs.send(
        JSON.stringify({
          type: 'chesscom_review_result',
          requestId,
          analysis,
        })
      );
    }

    const white = gameData.headers.White || '?';
    const black = gameData.headers.Black || '?';
    logEnd({ requestId: gameId, email: userEmail || gameId, type: 'game-review', result: `${white} vs ${black}` });
  } catch (error) {
    logError({ requestId: gameId, email: userEmail || gameId, type: 'game-review', error: error instanceof Error ? error.message : 'Unknown error' });
    if (clientWs.readyState === 1) {
      clientWs.send(
        JSON.stringify({
          type: 'chesscom_review_error',
          requestId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  }
}
