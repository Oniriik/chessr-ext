import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { createNodeWebSocket } from '@hono/node-ws';
import { suggestionQueue, type SuggestionResult } from '../lib/suggestionQueue.js';
import { handleChesscomReview, type ReviewMessage } from '../handlers/chesscomReview.js';
import { normalizeSearchOptions } from '../engine/searchOptions.js';
import { isUserPremium } from '../lib/premium.js';

type WSApp = {
  app: Hono;
  upgradeWebSocket: ReturnType<typeof createNodeWebSocket>['upgradeWebSocket'];
};

const clients = new Map<string, WSContext>();
const verifiedPremium = new Set<string>();

// Listen for completed suggestion jobs and send results back to clients
suggestionQueue.on('completed', (event) => {
  // This doesn't work on Queue — we handle it via the worker in index.ts
});

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
          console.log(`[WS] Connected: ${userId} (${clients.size} clients)`);
          // Beta gate: only premium users may use the server.
          isUserPremium(userId).then((premium) => {
            if (!premium) {
              console.log(`[WS] Rejecting non-premium user ${userId}`);
              ws.send(JSON.stringify({ type: 'beta_gate', reason: 'Chessr is in beta — premium only.' }));
              ws.close(1008, 'premium-only');
              clients.delete(userId);
              verifiedPremium.delete(userId);
            } else {
              verifiedPremium.add(userId);
              ws.send(JSON.stringify({ type: 'connected' }));
            }
          }).catch((err) => {
            console.warn(`[WS] Premium check failed for ${userId}`, err);
            ws.close(1011, 'server-error');
            clients.delete(userId);
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
              case 'suggestion': {
                const search = normalizeSearchOptions(
                  msg.search ?? (msg.searchMode
                    ? { mode: msg.searchMode, nodes: msg.searchNodes, depth: msg.searchDepth, movetime: msg.searchMovetime }
                    : null),
                );
                console.log(`[WS] ${userId}: suggestion request — fen=${msg.fen}, elo=${msg.targetElo}, multiPv=${msg.multiPv}, search=${search ? `${search.mode}:${search.nodes ?? search.depth ?? search.movetime}` : 'default'}`);
                suggestionQueue.add('suggestion', {
                  requestId: msg.requestId,
                  userId,
                  fen: msg.fen,
                  moves: msg.moves || [],
                  targetElo: msg.targetElo || 1500,
                  personality: msg.personality || 'Default',
                  multiPv: msg.multiPv || 3,
                  limitStrength: msg.limitStrength ?? true,
                  ...(search ? { search } : {}),
                }, { priority: msg.priority || 0 });
                break;
              }

              case 'chesscom_review':
                console.log(`[WS] ${userId}: review request — gameId=${msg.gameId}`);
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
          verifiedPremium.delete(userId);
          console.log(`[WS] Disconnected: ${userId} (${clients.size} clients)`);
        },
      };
    }),
  );
}

export function getClients() {
  return clients;
}
