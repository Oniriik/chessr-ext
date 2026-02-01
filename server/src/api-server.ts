/**
 * API Server
 * Express REST API server for subscription management and Paddle webhooks
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import subscriptionRoutes from './routes/subscription.routes';
import webhookRoutes from './routes/paddle-webhook.routes';

const API_PORT = process.env.API_PORT || 3002;

/**
 * Create and configure the Express API server
 */
export function createApiServer(): Express {
  const app = express();

  // CORS configuration
  app.use(
    cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'https://chessr.io',
        'https://www.chessr.io',
      ],
      credentials: true,
    })
  );

  // Webhook route needs raw body for signature verification
  app.use(
    '/api/webhooks/paddle',
    express.raw({ type: 'application/json' }),
    (req: Request, res: Response, next) => {
      // Store raw body for signature verification
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body.toString('utf-8');
        // Parse as JSON for processing
        try {
          req.body = JSON.parse(req.rawBody);
        } catch (err) {
          console.error('[API] Error parsing webhook body:', err);
        }
      }
      next();
    }
  );

  // JSON body parser for other routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'Chessr API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  app.use('/api/subscription', subscriptionRoutes);
  app.use('/api/webhooks/paddle', webhookRoutes);

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // Error handler
  app.use((err: any, req: Request, res: Response, next: any) => {
    console.error('[API] Error:', err);
    res.status(err.status || 500).json({
      error: err.name || 'Internal Server Error',
      message: err.message || 'An unexpected error occurred',
    });
  });

  return app;
}

/**
 * Start the API server
 */
export function startApiServer(): void {
  const app = createApiServer();

  app.listen(API_PORT, () => {
    console.log(`[API] Server running on port ${API_PORT}`);
    console.log(`[API] Health check: http://localhost:${API_PORT}/health`);
    console.log(`[API] Subscription API: http://localhost:${API_PORT}/api/subscription`);
    console.log(`[API] Paddle Webhooks: http://localhost:${API_PORT}/api/webhooks/paddle`);
  });
}

// Start server if run directly
if (require.main === module) {
  startApiServer();
}
