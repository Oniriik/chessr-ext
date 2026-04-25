import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { createNodeWebSocket } from '@hono/node-ws';
import { handleChesscomReview, type ReviewMessage } from '../handlers/chesscomReview.js';
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
              case 'suggestion_log_start':
                recordSuggestion(userId, msg.extra);
                logStart(userId, msg.requestId, 'suggestion', msg.extra);
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

              default:
                console.log(`[WS] ${userId}: unhandled message type "${msg.type}"`);
            }
          } catch {
            sendToClient(userId, { type: 'error', message: 'Invalid JSON' });
          }
        },

        onClose() {
          if (!valid) return;
          clients.delete(userId);
          connectedAt.delete(userId);
          dropUserState(userId);
          handleUserDisconnectSuggestion(userId);
          handleUserDisconnectAnalysis(userId);
          handleUserDisconnectMaia(userId);
          handleUserDisconnectMaia3(userId);
          logDisconnected(userId, clients.size);
        },
      };
    }),
  );
}

export function getClients() {
  return clients;
}
