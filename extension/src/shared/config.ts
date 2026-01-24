// Configuration loaded from environment variables at build time

export const config = {
  // WebSocket server URL - injected by webpack at build time
  stockfishServerUrl: process.env.STOCKFISH_SERVER_URL || 'ws://localhost:3000',

  // Environment
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',
};

// Log configuration in development
if (config.isDevelopment) {
  console.log('[Chessr Config]', {
    serverUrl: config.stockfishServerUrl,
    environment: process.env.NODE_ENV,
  });
}
