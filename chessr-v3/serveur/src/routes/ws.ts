import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { createNodeWebSocket } from '@hono/node-ws';
import { handleChesscomReview, type ReviewMessage } from '../handlers/chesscomReview.js';
import {
  handleProfileAnalysis,
  handleProfileAnalysisSubscribe,
  handleProfileAnalysisDisconnect,
  type ProfileAnalysisStartMessage,
  type ProfileAnalysisSubscribeMessage,
} from '../handlers/profileAnalysisHandler.js';
import {
  handleSuggestionRequest,
  handleUserDisconnectSuggestion,
  type SuggestionMessage,
} from '../handlers/suggestionHandler.js';
import {
  handleAnalysisRequest,
  handleFenEvalRequest,
  handleUserDisconnectAnalysis,
  type AnalysisMessage,
  type FenEvalMessage,
} from '../handlers/analysisHandler.js';
import {
  handleMaiaRequest,
  handleUserDisconnectMaia,
  type MaiaMessage,
} from '../handlers/maiaHandler.js';
import {
  handleMaia3Request,
  handleUserDisconnectMaia3,
  type Maia3Message,
} from '../handlers/maia3Handler.js';
import { logStart, logEnd, logConnected, logDisconnected } from '../lib/wsLog.js';
import {
  recordSuggestion,
  recordAnalysis,
  recordEval,
  getUserState,
  dropUser as dropUserState,
} from '../lib/userState.js';
import { supabase } from '../lib/supabase.js';
import { insertUserActivity, type ActivityEventType, type EngineId, type EventSource } from '../lib/analyticsRepo.js';

type WSApp = {
  app: Hono;
  upgradeWebSocket: ReturnType<typeof createNodeWebSocket>['upgradeWebSocket'];
};

const clients = new Map<string, WSContext>();
const connectedAt = new Map<string, number>();

export function getConnectedUsers(): Array<{ userId: string; connectedAt: number }> {
  return Array.from(connectedAt.entries()).map(([userId, ts]) => ({ userId, connectedAt: ts }));
}

export function getConnectedUsersDetailed() {
  return Array.from(connectedAt.entries()).map(([userId, ts]) => {
    const s = getUserState(userId);
    return {
      userId,
      connectedAt: ts,
      lastSuggestion: s?.lastSuggestion ?? null,
      lastAnalysis: s?.lastAnalysis ?? null,
      lastEval: s?.lastEval ?? null,
    };
  });
}

export function sendToClient(userId: string, data: any) {
  const ws = clients.get(userId);
  if (ws) ws.send(JSON.stringify(data));
}

// Loose UUID/word check — userId comes from `?userId=...` and we want to
// drop empty / clearly-invalid values without locking out future schemes.
function isValidUserId(uid: string | undefined): uid is string {
  if (!uid) return false;
  if (uid === 'anonymous' || uid === 'undefined' || uid === 'null') return false;
  return /^[A-Za-z0-9_-]{8,64}$/.test(uid);
}

export function registerWsRoute({ app, upgradeWebSocket }: WSApp) {
  app.get(
    '/ws',
    upgradeWebSocket((c) => {
      const rawUid = c.req.query('userId');
      const userId = isValidUserId(rawUid) ? rawUid : 'anonymous';
      const valid = userId !== 'anonymous';

      return {
        onOpen(_event, ws) {
          if (!valid) {
            // Refuse silently — the extension always passes a real userId,
            // so anything else (bot scans, manual wscat, leftover tabs) is
            // not actionable. Just close so the rare legit caller knows.
            ws.send(JSON.stringify({ type: 'error', message: 'missing or invalid userId' }));
            try { ws.close(4001, 'missing userId'); } catch { /* ignore */ }
            return;
          }
          clients.set(userId, ws);
          connectedAt.set(userId, Date.now());
          logConnected(userId, clients.size);
          // All engines are free — no premium gate. Just ack.
          ws.send(JSON.stringify({ type: 'connected' }));
        },

        onMessage(event, _ws) {
          if (!valid) return;  // refused at onOpen, ignore any straggler messages
          try {
            const msg = JSON.parse(event.data as string);
            const send = (data: unknown) => sendToClient(userId, data);

            switch (msg.type) {
              // Client-side suggestion telemetry (WASM computes, server logs).
              // Also persist to user_activity so the analytics page sees WASM
              // suggestions — without this only server-side fallbacks land.
              case 'suggestion_log_start':
                recordSuggestion(userId, msg.extra);
                logStart(userId, msg.requestId, 'suggestion', msg.extra);
                logActivityFromExtra(userId, 'suggestion', msg.extra);
                break;

              case 'suggestion_log_end':
                logEnd(userId, msg.requestId, 'suggestion', msg.extra);
                break;

              // Server-side Komodo fallback — extension asks for a suggestion
              // because its WASM failed to init.
              case 'suggestion_request':
                handleSuggestionRequest(msg as SuggestionMessage, userId, send);
                break;

              // Server-side Maia 2 fallback (native binary via MaiaPool).
              case 'maia_request':
                handleMaiaRequest(msg as MaiaMessage, userId, send);
                break;

              // Server-side Maia 3 fallback (ONNX via onnxruntime-node).
              case 'maia3_request':
                handleMaia3Request(msg as Maia3Message, userId, send);
                break;

              // Server-side Stockfish move-analysis fallback (classification).
              case 'analysis_request':
                handleAnalysisRequest(msg as AnalysisMessage, userId, send);
                break;

              // Single-FEN eval (used by client ServerAnalysisEngine fallback).
              case 'engine_eval_request':
                handleFenEvalRequest(msg as FenEvalMessage, userId, send);
                break;

              // Client-side analysis telemetry (extension computed via Stockfish
              // WASM or via the server fallback — `extra` carries source=...).
              case 'analysis_log_start':
                recordAnalysis(userId, msg.extra);
                logStart(userId, msg.requestId, 'analysis', msg.extra);
                logActivityFromExtra(userId, 'analysis', msg.extra);
                break;

              case 'analysis_log_end':
                logEnd(userId, msg.requestId, 'analysis', msg.extra);
                break;

              // Eval-bar single-FEN telemetry (fires after each opponent
              // move). Same WASM/server source split as analysis.
              case 'eval_log_start':
                recordEval(userId, msg.extra);
                logStart(userId, msg.requestId, 'eval', msg.extra);
                break;

              case 'eval_log_end':
                logEnd(userId, msg.requestId, 'eval', msg.extra);
                break;

              case 'chesscom_review':
                logStart(userId, msg.requestId, 'review', `gameId=${msg.gameId}`);
                handleChesscomReview(
                  msg as ReviewMessage,
                  send,
                  userId,
                ).catch((err) => {
                  console.error(`[WS] ${userId}: review error`, err);
                  send({ type: 'chesscom_review_error', requestId: msg.requestId, error: 'Internal error' });
                });
                break;

              // Handshake for the chessr-app (game review + profile analysis on
              // app.chessr.io). The app connects with ?userId=<supabase.user.id>
              // in the URL like the extension does, then sends an `auth` message
              // carrying the Supabase access_token and a shared APP_AUTH_TOKEN.
              // We verify the token resolves to the same userId and that the
              // shared secret matches; on success we ack with `auth_success` so
              // the app's state machine unlocks. Failures close the socket so a
              // stale / spoofed token can't sit on the connection.
              case 'auth':
                handleAuth(msg as AuthMessage, userId, send, _ws);
                break;

              // app.chessr.io profile-analysis flow. The app POSTs a row to
              // Supabase first (status='pending'), then opens this WS and
              // streams progress via broadcast(). _start kicks off the
              // chess.com archive scan + per-game analysis; _subscribe
              // re-attaches to a running or finished one (on tab reload).
              case 'profile_analysis_start':
                handleProfileAnalysis(msg as ProfileAnalysisStartMessage, _ws, userId)
                  .catch((err) => {
                    console.error(`[WS] ${userId}: profile_analysis_start error`, err);
                  });
                break;

              case 'profile_analysis_subscribe':
                handleProfileAnalysisSubscribe(msg as ProfileAnalysisSubscribeMessage, _ws, userId)
                  .catch((err) => {
                    console.error(`[WS] ${userId}: profile_analysis_subscribe error`, err);
                  });
                break;

              default:
                console.log(`[WS] ${userId}: unhandled message type "${msg.type}"`);
            }
          } catch {
            sendToClient(userId, { type: 'error', message: 'Invalid JSON' });
          }
        },

        onClose(_event, ws) {
          if (!valid) return;
          clients.delete(userId);
          connectedAt.delete(userId);
          dropUserState(userId);
          handleUserDisconnectSuggestion(userId);
          handleUserDisconnectAnalysis(userId);
          handleUserDisconnectMaia(userId);
          handleUserDisconnectMaia3(userId);
          handleProfileAnalysisDisconnect(ws);
          logDisconnected(userId, clients.size);
        },
      };
    }),
  );
}

export function getClients() {
  return clients;
}

// ─── user_activity insert from telemetry strings ────────────────────────
// The extension sends `extra` as a key=value string for log events
// (e.g. "source=wasm engine=maia3 elo=1500 mpv=3 limit=true …"). We
// parse engine + source from it and feed insertUserActivity so WASM
// suggestions land in analytics like server-side ones.

const VALID_ENGINES = new Set<EngineId>(['komodo', 'maia2', 'maia3', 'stockfish']);
const VALID_SOURCES = new Set<EventSource>(['server', 'wasm']);

function parseExtra(extra: unknown): { engine?: EngineId; source?: EventSource } {
  if (typeof extra !== 'string') return {};
  const out: { engine?: EngineId; source?: EventSource } = {};
  for (const part of extra.split(/\s+/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === 'engine' && VALID_ENGINES.has(v as EngineId)) out.engine = v as EngineId;
    else if (k === 'source' && VALID_SOURCES.has(v as EventSource)) out.source = v as EventSource;
  }
  return out;
}

function logActivityFromExtra(userId: string, eventType: ActivityEventType, extra: unknown): void {
  const { engine, source } = parseExtra(extra);
  if (!engine) return; // skip if we can't classify — avoids polluting with unknowns
  insertUserActivity({ userId, eventType, engine, source })
    .catch((err) => console.warn(`[ws] activity log failed (${eventType} / ${engine}):`, err));
}

// ─── Auth handshake (app + future external integrations) ────────────────

interface AuthMessage {
  type: 'auth';
  /** Supabase access_token (JWT). The `sub` claim must match the userId
   *  in the WS URL query. */
  token: string;
  /** Source of the connection: 'app' triggers the appToken check;
   *  anything else is treated as a generic verified session. */
  source?: 'app' | string;
  /** Shared secret matching the serveur's APP_AUTH_TOKEN env. Required
   *  when source='app'. Keeps random bots from impersonating the app
   *  even if they manage to forge a Supabase token. */
  appToken?: string;
}

async function handleAuth(
  msg: AuthMessage,
  expectedUserId: string,
  send: (data: unknown) => void,
  ws: WSContext,
): Promise<void> {
  if (msg.source === 'app') {
    const expected = process.env.APP_AUTH_TOKEN;
    if (!expected) {
      console.warn('[WS auth] source=app but APP_AUTH_TOKEN env is unset; rejecting');
      send({ type: 'auth_error', error: 'server_misconfigured' });
      try { ws.close(4002, 'server misconfigured'); } catch { /* ignore */ }
      return;
    }
    if (msg.appToken !== expected) {
      send({ type: 'auth_error', error: 'invalid_app_token' });
      try { ws.close(4003, 'invalid app token'); } catch { /* ignore */ }
      return;
    }
  }

  if (!msg.token) {
    send({ type: 'auth_error', error: 'missing_token' });
    try { ws.close(4003, 'missing token'); } catch { /* ignore */ }
    return;
  }

  // Supabase verifies the JWT signature + expiration. We trust the
  // returned user.id to be the real owner of the access_token.
  const { data, error } = await supabase.auth.getUser(msg.token);
  if (error || !data?.user) {
    send({ type: 'auth_error', error: 'invalid_token' });
    try { ws.close(4003, 'invalid token'); } catch { /* ignore */ }
    return;
  }
  if (data.user.id !== expectedUserId) {
    // The connection opened with one userId in the URL but the token
    // resolves to a different user — almost certainly a spoofing
    // attempt. Refuse rather than silently re-bind.
    send({ type: 'auth_error', error: 'user_id_mismatch' });
    try { ws.close(4003, 'user id mismatch'); } catch { /* ignore */ }
    return;
  }
  send({ type: 'auth_success', userId: data.user.id });
}
