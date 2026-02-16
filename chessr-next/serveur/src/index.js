import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';

const PORT = process.env.PORT || 8080;

// Initialize Supabase client with service role key for token verification
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Store authenticated connections
const clients = new Map();

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
  console.log('New connection');

  let userId = null;
  let isAuthenticated = false;

  // Set a timeout for authentication (10 seconds)
  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) {
      console.log('Authentication timeout, closing connection');
      ws.close(4001, 'Authentication timeout');
    }
  }, 10000);

  ws.on('message', async (data) => {
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
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
          console.log('Authentication failed:', error?.message || 'Invalid token');
          ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
          ws.close(4003, 'Invalid token');
          return;
        }

        // Authentication successful
        clearTimeout(authTimeout);
        isAuthenticated = true;
        userId = user.id;

        // Store the connection
        clients.set(userId, { ws, user });

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
      if (!isAuthenticated) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
        return;
      }

      // Handle other message types here
      console.log(`Message from ${userId}:`, message);

      // Echo for now
      ws.send(JSON.stringify({ type: 'echo', data: message }));

    } catch (err) {
      console.error('Error processing message:', err);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (userId) {
      clients.delete(userId);
      console.log(`User disconnected: ${userId}`);
    } else {
      console.log('Unauthenticated connection closed');
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

wss.on('listening', () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
