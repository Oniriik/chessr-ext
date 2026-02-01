/**
 * Paddle Webhook Routes
 * Routes for handling Paddle webhook events
 */

import { Router } from 'express';
import { paddleWebhookMiddleware } from '../middleware/paddle-webhook.middleware';
import { handlePaddleWebhook } from '../controllers/paddle-webhook.controller';

const router = Router();

/**
 * POST /api/webhooks/paddle
 * Receive and process Paddle webhook events
 * Signature verification middleware is applied
 */
router.post('/', paddleWebhookMiddleware, handlePaddleWebhook);

export default router;
