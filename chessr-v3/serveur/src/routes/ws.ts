import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { createNodeWebSocket } from '@hono/node-ws';
import { handleChesscomReview, type ReviewMessage } from '../handlers/chesscomReview.js';
import { isUserPremium } from '../lib/premium.js';
import { logStart, logEnd, logConnected, logDisconnected } from '../lib/wsLog.js';

type WSApp = {
  app: Hono;
  upgradeWebSocket: ReturnType<typeof createNodeWebSocket>['upgradeWebSocket'];
};

const clients = new Map<string, WSContext>();
const verifiedPremium = new Set<string>();
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
          // Beta gate: only premium users may use the server.
          isUserPremium(userId).then((premium) => {
            if (!premium) {
              console.log(`[WS] Rejecting non-premium user ${userId}`);
              ws.send(JSON.stringify({ type: 'beta_gate', reason: 'Chessr is in beta — premium only.' }));
              ws.close(1008, 'premium-only');
              clients.delete(userId);
              connectedAt.delete(userId);
              verifiedPremium.delete(userId);
            } else {
              verifiedPremium.add(userId);
              ws.send(JSON.stringify({ type: 'connected' }));
            }
          }).catch((err) => {
            console.warn(`[WS] Premium check failed for ${userId}`, err);
            ws.close(1011, 'server-error');
            clients.delete(userId);
            connectedAt.delete(userId);
            verifiedPremium.delete(userId);
          });
        },

        onMessage(event, _ws) {
          try {
            const msg = JSON.parse(event.data as string);

            // Hard gate: reject any action from non-verified premium users.
            if (!verifiedPremium.has(userId)) {
              console.log(`[WS] Drop ${msg?.type} from non-premium ${userId}`);
              sendToClient(userId, { type: 'beta_gate', reason: 'Chessr is in beta — premium only.' });
              return;
            }

            switch (msg.type) {
              // Suggestions are computed client-side (Dragon WASM) now, but
              // the extension still reports their start/end to the server
              // for observability — same wsLog format the engine handler
              // used to produce.
              case 'suggestion_log_start':
                logStart(userId, msg.requestId, 'suggestion', msg.extra);
                break;

              case 'suggestion_log_end':
                logEnd(userId, msg.requestId, 'suggestion', msg.extra);
                break;

              case 'chesscom_review':
                logStart(userId, msg.requestId, 'review', `gameId=${msg.gameId}`);
                handleChesscomReview(
                  msg as ReviewMessage,
                  (data) => sendToClient(userId, data),
                  userId,
                ).catch((err) => {
                  console.error(`[WS] ${userId}: review error`, err);
                  sendToClient(userId, { type: 'chesscom_review_error', requestId: msg.requestId, error: 'Internal error' });
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
          verifiedPremium.delete(userId);
          logDisconnected(userId, clients.size);
        },
      };
    }),
  );
}

export function getClients() {
  return clients;
}
