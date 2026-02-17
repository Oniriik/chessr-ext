import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import {
  initEnginePool,
  handleSuggestionRequest,
  handleUserDisconnect,
  shutdownEnginePool,
  type Client,
  type SuggestionMessage,
} from './handlers/suggestionHandler.js';
import {
  initStockfishPool,
  handleAnalysisRequest,
  handleAnalysisDisconnect,
  shutdownStockfishPool,
  type AnalysisMessage,
} from './handlers/analysisHandler.js';

const PORT = parseInt(process.env.PORT || '8080');
const MAX_KOMODO_INSTANCES = parseInt(process.env.MAX_KOMODO_INSTANCES || '2');
const MAX_STOCKFISH_INSTANCES = parseInt(process.env.MAX_STOCKFISH_INSTANCES || '1');

// Initialize Supabase client with service role key for token verification
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Store authenticated connections
const clients = new Map<string, Client>();

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server starting on port ${PORT}...`);

// Initialize engine pools (Komodo for suggestions, Stockfish for analysis)
initEnginePool(MAX_KOMODO_INSTANCES).catch((err) => {
  console.error('Failed to initialize Komodo pool:', err);
  process.exit(1);
});

initStockfishPool(MAX_STOCKFISH_INSTANCES).catch((err) => {
  console.error('Failed to initialize Stockfish pool:', err);
  process.exit(1);
});

wss.on('connection', (ws: WebSocket) => {
  console.log('New connection');

  let userId: string | null = null;
  let isAuthenticated = false;

  // Set a timeout for authentication (10 seconds)
  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) {
      console.log('Authentication timeout, closing connection');
      ws.close(4001, 'Authentication timeout');
    }
  }, 10000);

  ws.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle authentication
      if (message.type === 'auth') {
        const token = message.token;

        if (!token) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'No token provided' }));
          ws.close(4002, 'No token provided');
          return;
        }

        // Verify the token with Supabase
        const { data: authData, error } = await supabase.auth.getUser(token);

        if (error || !authData.user) {
          console.log('Authentication failed:', error?.message || 'Invalid token');
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
          ws.close(4003, 'Invalid token');
          return;
        }

        const user = authData.user;

        // Authentication successful
        clearTimeout(authTimeout);
        isAuthenticated = true;
        userId = user.id;

        // Store the connection
        clients.set(userId, { ws, user: { id: user.id, email: user.email || '' } });

        console.log(`User authenticated: ${user.email} (${userId})`);
        ws.send(JSON.stringify({
          type: 'auth_success',
          user: {
            id: user.id,
            email: user.email
          }
        }));
        return;
      }

      // All other messages require authentication
      if (!isAuthenticated || !userId) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
        return;
      }

      // Handle message types
      switch (message.type) {
        case 'suggestion':
          handleSuggestionRequest(message as SuggestionMessage, clients.get(userId)!);
          break;

        case 'analyze':
          handleAnalysisRequest(message as AnalysisMessage, clients.get(userId)!);
          break;

        default:
          console.log(`Unknown message type from ${userId}:`, message.type);
          ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
      }

    } catch (err) {
      console.error('Error processing message:', err);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (userId) {
      // Cancel any pending requests for this user
      handleUserDisconnect(userId);
      handleAnalysisDisconnect(userId);
      clients.delete(userId);
      console.log(`User disconnected: ${userId}`);
    } else {
      console.log('Unauthenticated connection closed');
    }
  });

  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err);
  });
});

wss.on('listening', () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down...');
  await Promise.all([
    shutdownEnginePool(),
    shutdownStockfishPool(),
  ]);
  wss.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
