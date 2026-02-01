/**
 * Paddle Webhook Controller
 * Processes Paddle webhook events
 */

import { Request, Response } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import type {
  PaddleWebhookEvent,
  PaddleSubscriptionCreatedData,
  PaddleTransactionCompletedData,
} from '../types/subscription.types';

const subscriptionService = new SubscriptionService();

/**
 * POST /api/webhooks/paddle
 * Main webhook handler for all Paddle events
 */
export async function handlePaddleWebhook(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const event = req.body as PaddleWebhookEvent;

    console.log(`[PaddleWebhook] Received event: ${event.event_type} (${event.event_id})`);

    // Log event to database
    await subscriptionService.logPaymentEvent(
      event.event_id,
      event.event_type,
      event.data
    );

    // Route to appropriate handler based on event type
    switch (event.event_type) {
      case 'subscription.created':
        await handleSubscriptionCreated(event);
        break;

      case 'subscription.updated':
        await handleSubscriptionUpdated(event);
        break;

      case 'subscription.canceled':
        await handleSubscriptionCanceled(event);
        break;

      case 'subscription.paused':
        await handleSubscriptionPaused(event);
        break;

      case 'subscription.resumed':
        await handleSubscriptionResumed(event);
        break;

      case 'transaction.completed':
        await handleTransactionCompleted(event);
        break;

      case 'transaction.payment_failed':
        await handlePaymentFailed(event);
        break;

      default:
        console.log(`[PaddleWebhook] Unhandled event type: ${event.event_type}`);
    }

    // Mark event as processed
    await subscriptionService.markEventProcessed(event.event_id);

    // Always return 200 to Paddle
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[PaddleWebhook] Error processing webhook:', err);

    // Mark event with error
    try {
      const event = req.body as PaddleWebhookEvent;
      await subscriptionService.markEventProcessed(
        event.event_id,
        err instanceof Error ? err.message : 'Unknown error'
      );
    } catch (markErr) {
      console.error('[PaddleWebhook] Error marking event as errored:', markErr);
    }

    // Still return 200 to prevent retries for unrecoverable errors
    res.status(200).json({ received: true, error: true });
  }
}

/**
 * Handle subscription.created event
 * Creates new subscription record in database
 */
async function handleSubscriptionCreated(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as PaddleSubscriptionCreatedData;
    const userId = data.custom_data?.user_id;

    if (!userId) {
      console.error('[PaddleWebhook] No user_id in subscription.created custom_data');
      return;
    }

    // Get plan from Paddle product ID
    const productId = data.items[0]?.price?.product_id;
    if (!productId) {
      console.error('[PaddleWebhook] No product_id in subscription items');
      return;
    }

    const plan = await subscriptionService.getPlanByPaddleProductId(productId);
    if (!plan) {
      console.error(`[PaddleWebhook] Plan not found for product: ${productId}`);
      return;
    }

    // Create subscription
    await subscriptionService.createSubscription({
      userId,
      paddleCustomerId: data.customer_id,
      paddleSubscriptionId: data.id,
      planId: plan.id,
      status: data.status as any,
      currentPeriodStart: data.current_billing_period?.starts_at || new Date().toISOString(),
      currentPeriodEnd: data.current_billing_period?.ends_at || null,
    });

    console.log(`[PaddleWebhook] Subscription created for user ${userId}`);
  } catch (err) {
    console.error('[PaddleWebhook] Error handling subscription.created:', err);
    throw err;
  }
}

/**
 * Handle subscription.updated event
 */
async function handleSubscriptionUpdated(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as PaddleSubscriptionCreatedData;

    await subscriptionService.updateSubscription({
      paddleSubscriptionId: data.id,
      status: data.status as any,
      currentPeriodStart: data.current_billing_period?.starts_at,
      currentPeriodEnd: data.current_billing_period?.ends_at,
    });

    console.log(`[PaddleWebhook] Subscription updated: ${data.id}`);
  } catch (err) {
    console.error('[PaddleWebhook] Error handling subscription.updated:', err);
    throw err;
  }
}

/**
 * Handle subscription.canceled event
 */
async function handleSubscriptionCanceled(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as any;

    await subscriptionService.updateSubscription({
      paddleSubscriptionId: data.id,
      status: 'canceled',
      canceledAt: new Date().toISOString(),
    });

    console.log(`[PaddleWebhook] Subscription canceled: ${data.id}`);
  } catch (err) {
    console.error('[PaddleWebhook] Error handling subscription.canceled:', err);
    throw err;
  }
}

/**
 * Handle subscription.paused event
 */
async function handleSubscriptionPaused(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as any;

    await subscriptionService.updateSubscription({
      paddleSubscriptionId: data.id,
      status: 'paused',
    });

    console.log(`[PaddleWebhook] Subscription paused: ${data.id}`);
  } catch (err) {
    console.error('[PaddleWebhook] Error handling subscription.paused:', err);
    throw err;
  }
}

/**
 * Handle subscription.resumed event
 */
async function handleSubscriptionResumed(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as any;

    await subscriptionService.updateSubscription({
      paddleSubscriptionId: data.id,
      status: 'active',
    });

    console.log(`[PaddleWebhook] Subscription resumed: ${data.id}`);
  } catch (err) {
    console.error('[PaddleWebhook] Error handling subscription.resumed:', err);
    throw err;
  }
}

/**
 * Handle transaction.completed event (for one-time purchases like Lifetime)
 */
async function handleTransactionCompleted(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as PaddleTransactionCompletedData;
    const userId = data.custom_data?.user_id;

    if (!userId) {
      console.error('[PaddleWebhook] No user_id in transaction.completed custom_data');
      return;
    }

    // Get plan from Paddle product ID
    const productId = data.items[0]?.price?.product_id;
    if (!productId) {
      console.error('[PaddleWebhook] No product_id in transaction items');
      return;
    }

    const plan = await subscriptionService.getPlanByPaddleProductId(productId);
    if (!plan) {
      console.error(`[PaddleWebhook] Plan not found for product: ${productId}`);
      return;
    }

    // Check if this is a lifetime purchase (one_time billing cycle)
    if (plan.billing_cycle === 'one_time') {
      // Create lifetime subscription (NULL end date)
      await subscriptionService.createSubscription({
        userId,
        paddleCustomerId: data.customer_id,
        paddleSubscriptionId: data.id, // transaction ID for one-time
        planId: plan.id,
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: null, // Lifetime = no expiration
      });

      console.log(`[PaddleWebhook] Lifetime subscription created for user ${userId}`);
    }
  } catch (err) {
    console.error('[PaddleWebhook] Error handling transaction.completed:', err);
    throw err;
  }
}

/**
 * Handle transaction.payment_failed event
 */
async function handlePaymentFailed(event: PaddleWebhookEvent): Promise<void> {
  try {
    const data = event.data as any;

    // If there's a subscription_id, mark as past_due
    if (data.subscription_id) {
      await subscriptionService.updateSubscription({
        paddleSubscriptionId: data.subscription_id,
        status: 'past_due',
      });

      console.log(`[PaddleWebhook] Payment failed for subscription: ${data.subscription_id}`);
    }
  } catch (err) {
    console.error('[PaddleWebhook] Error handling payment failure:', err);
    throw err;
  }
}
