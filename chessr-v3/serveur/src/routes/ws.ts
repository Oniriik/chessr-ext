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
import { logStart, logEnd, logConnected, logDisconnected } from '../lib/wsLog.js';

type WSApp = {
  app: Hono;
  upgradeWebSocket: ReturnType<typeof createNodeWebSocket>['upgradeWebSocket'];
};

const clients = new Map<string, WSContext>();
const connectedAt = new Map<string, number>();

export function getConnectedUsers(): Array<{ userId: string; connectedAt: number }> {
  return Array.from(connectedAt.entries()).map(([userId, ts]) => ({ userId, connectedAt: ts }));
}

export function sendToClient(userId: string, data: any) {
  const ws = clients.get(userId);
  if (ws) ws.send(JSON.stringify(data));
}

export function registerWsRoute({ app, upgradeWebSocket }: WSApp) {
  app.get(
    '/ws',
    upgradeWebSocket((c) => {
      const userId = c.req.query('userId') || 'anonymous';

      return {
        onOpen(_event, ws) {
          clients.set(userId, ws);
          connectedAt.set(userId, Date.now());
          logConnected(userId, clients.size);
          // All engines are free — no premium gate. Just ack.
          ws.send(JSON.stringify({ type: 'connected' }));
        },

        onMessage(event, _ws) {
          try {
            const msg = JSON.parse(event.data as string);
            const send = (data: unknown) => sendToClient(userId, data);

            switch (msg.type) {
              // Client-side suggestion telemetry (WASM computes, server logs).
              case 'suggestion_log_start':
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
                logStart(userId, msg.requestId, 'analysis', msg.extra);
                break;

              case 'analysis_log_end':
                logEnd(userId, msg.requestId, 'analysis', msg.extra);
                break;

              // Eval-bar single-FEN telemetry (fires after each opponent
              // move). Same WASM/server source split as analysis.
              case 'eval_log_start':
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
          clients.delete(userId);
          connectedAt.delete(userId);
          handleUserDisconnectSuggestion(userId);
          handleUserDisconnectAnalysis(userId);
          logDisconnected(userId, clients.size);
        },
      };
    }),
  );
}

export function getClients() {
  return clients;
}
