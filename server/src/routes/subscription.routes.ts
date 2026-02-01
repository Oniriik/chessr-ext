/**
 * Subscription Routes
 * API routes for subscription management
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import {
  getSubscriptionStatus,
  createCheckout,
  cancelSubscription,
  getPlans,
  getUpdatePaymentUrl,
} from '../controllers/subscription.controller';

const router = Router();

// All subscription routes require authentication
router.use(authMiddleware);

/**
 * GET /api/subscription/status
 * Get current user's subscription status
 */
router.get('/status', getSubscriptionStatus);

/**
 * GET /api/subscription/plans
 * Get all available subscription plans
 */
router.get('/plans', getPlans);

/**
 * POST /api/subscription/checkout
 * Create a checkout session for a plan
 * Body: { planId: string, successUrl?: string, customData?: object }
 */
router.post('/checkout', createCheckout);

/**
 * POST /api/subscription/cancel
 * Cancel the user's subscription
 * Body: { immediate?: boolean }
 */
router.post('/cancel', cancelSubscription);

/**
 * POST /api/subscription/update-payment
 * Get URL to update payment method
 */
router.post('/update-payment', getUpdatePaymentUrl);

export default router;
