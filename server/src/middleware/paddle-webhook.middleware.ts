/**
 * Paddle Webhook Middleware
 * Verifies Paddle webhook signatures
 */

import { Request, Response, NextFunction } from 'express';
import { PaddleService } from '../services/paddle.service';

// Store raw body for signature verification
declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

/**
 * Middleware to verify Paddle webhook signature
 * Must be used with express.raw() to get raw body
 *
 * In development mode (SKIP_WEBHOOK_VERIFICATION=true), signature verification is skipped
 */
export function paddleWebhookMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Skip verification in development if env var is set
    const skipVerification = process.env.SKIP_WEBHOOK_VERIFICATION === 'true';

    if (skipVerification) {
      console.warn('[PaddleWebhook] ⚠️  Signature verification SKIPPED (development mode)');
      next();
      return;
    }

    const signature = req.headers['paddle-signature'] as string;
    const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!signature) {
      console.error('[PaddleWebhook] Missing Paddle-Signature header');
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing Paddle-Signature header',
      });
      return;
    }

    if (!webhookSecret) {
      console.error('[PaddleWebhook] PADDLE_WEBHOOK_SECRET not configured');
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Webhook secret not configured',
      });
      return;
    }

    // Get raw body (must use express.raw() middleware before this)
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // Verify signature
    const paddleService = new PaddleService();
    const isValid = paddleService.verifyWebhookSignature(
      signature,
      rawBody,
      webhookSecret
    );

    if (!isValid) {
      console.error('[PaddleWebhook] Invalid webhook signature');
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
      });
      return;
    }

    console.log('[PaddleWebhook] Signature verified successfully');
    next();
  } catch (err) {
    console.error('[PaddleWebhook] Error verifying signature:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify webhook signature',
    });
  }
}
