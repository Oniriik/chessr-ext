/**
 * Subscription Controller
 * Handles subscription-related API requests
 */

import { Request, Response } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { PaddleService } from '../services/paddle.service';
import type {
  SubscriptionStatusResponse,
  CheckoutRequest,
  CheckoutResponse,
  CancelSubscriptionResponse,
  PlansResponse,
} from '../types/subscription.types';

const subscriptionService = new SubscriptionService();

// Lazy-load Paddle service (only when needed, requires PADDLE_API_KEY)
let _paddleService: PaddleService | null = null;
function getPaddleService(): PaddleService {
  if (!_paddleService) {
    _paddleService = new PaddleService();
  }
  return _paddleService;
}

/**
 * GET /api/subscription/status
 * Get user's subscription status
 */
export async function getSubscriptionStatus(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const subscription = await subscriptionService.getUserSubscription(userId);

    if (!subscription) {
      // No subscription record
      res.json({
        hasAccess: false,
        isBetaTester: false,
        subscription: null,
      } as SubscriptionStatusResponse);
      return;
    }

    const hasAccess = await subscriptionService.hasActiveSubscription(userId);

    res.json({
      hasAccess,
      isBetaTester: subscription.is_beta_tester,
      subscription: subscription.plan
        ? {
            status: subscription.status,
            planName: subscription.plan.name,
            billingCycle: subscription.plan.billing_cycle,
            currentPeriodEnd: subscription.current_period_end,
            canceledAt: subscription.canceled_at,
          }
        : null,
    } as SubscriptionStatusResponse);
  } catch (err) {
    console.error('[SubscriptionController] Error getting status:', err);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
}

/**
 * POST /api/subscription/checkout
 * Create Paddle checkout session
 */
export async function createCheckout(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;
    const body = req.body as CheckoutRequest;

    if (!userId || !userEmail) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { planId, successUrl, customData } = body;

    if (!planId) {
      res.status(400).json({ error: 'Missing planId' });
      return;
    }

    // Get plan details
    const plan = await subscriptionService.getPlanByName(planId);

    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    // For now, return a checkout URL that will be handled client-side with Paddle.js
    // The client will use Paddle.js to open the checkout modal
    const checkoutUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout?price_id=${plan.paddle_price_id}&user_id=${userId}&email=${userEmail}`;

    res.json({
      checkoutUrl,
      // Include plan details for client-side Paddle.js initialization
      priceId: plan.paddle_price_id,
      productId: plan.paddle_product_id,
    } as CheckoutResponse);
  } catch (err) {
    console.error('[SubscriptionController] Error creating checkout:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
}

/**
 * POST /api/subscription/cancel
 * Cancel user's subscription
 */
export async function cancelSubscription(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.id;
    const { immediate } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const subscription = await subscriptionService.getUserSubscription(userId);

    if (!subscription) {
      res.status(404).json({ error: 'No subscription found' });
      return;
    }

    if (subscription.is_beta_tester) {
      res.status(400).json({ error: 'Beta testers cannot cancel their lifetime access' });
      return;
    }

    if (!subscription.paddle_subscription_id) {
      res.status(400).json({ error: 'No active Paddle subscription' });
      return;
    }

    // Cancel in Paddle
    await getPaddleService().cancelSubscription(
      subscription.paddle_subscription_id,
      immediate ? 'immediately' : 'next_billing_period'
    );

    // Update in database
    const updated = await subscriptionService.cancelSubscription(userId);

    res.json({
      success: true,
      canceledAt: updated.canceled_at!,
      accessUntil: immediate ? null : updated.current_period_end,
    } as CancelSubscriptionResponse);
  } catch (err) {
    console.error('[SubscriptionController] Error canceling subscription:', err);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
}

/**
 * GET /api/subscription/plans
 * Get all available subscription plans
 */
export async function getPlans(req: Request, res: Response): Promise<void> {
  try {
    const plans = await subscriptionService.getPlans();

    res.json({
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        billingCycle: plan.billing_cycle,
        priceAmount: parseFloat(plan.price_amount.toString()),
        currency: plan.currency,
        paddleProductId: plan.paddle_product_id,
        paddlePriceId: plan.paddle_price_id,
      })),
    } as PlansResponse);
  } catch (err) {
    console.error('[SubscriptionController] Error getting plans:', err);
    res.status(500).json({ error: 'Failed to get subscription plans' });
  }
}

/**
 * POST /api/subscription/update-payment
 * Get URL to update payment method
 */
export async function getUpdatePaymentUrl(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const subscription = await subscriptionService.getUserSubscription(userId);

    if (!subscription || !subscription.paddle_subscription_id) {
      res.status(404).json({ error: 'No subscription found' });
      return;
    }

    const updateUrl = await getPaddleService().getUpdatePaymentMethodUrl(
      subscription.paddle_subscription_id
    );

    res.json({ updateUrl });
  } catch (err) {
    console.error('[SubscriptionController] Error getting update payment URL:', err);
    res.status(500).json({ error: 'Failed to get update payment URL' });
  }
}
