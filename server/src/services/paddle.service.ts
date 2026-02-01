/**
 * Paddle Service
 * Wrapper for Paddle API operations
 */

import { Paddle, Environment } from '@paddle/paddle-node-sdk';

export class PaddleService {
  private paddle: Paddle;
  private environment: Environment;

  constructor() {
    const apiKey = process.env.PADDLE_API_KEY;
    const environment = process.env.PADDLE_ENVIRONMENT || 'sandbox';

    if (!apiKey) {
      throw new Error('Missing PADDLE_API_KEY environment variable');
    }

    this.environment = environment === 'production' ? Environment.production : Environment.sandbox;

    this.paddle = new Paddle(apiKey, {
      environment: this.environment,
    });
  }

  /**
   * Get subscription details from Paddle
   */
  async getSubscription(subscriptionId: string) {
    try {
      const subscription = await this.paddle.subscriptions.get(subscriptionId);
      return subscription;
    } catch (err) {
      console.error('[PaddleService] Error getting subscription:', err);
      throw err;
    }
  }

  /**
   * Cancel subscription in Paddle
   * effectiveFrom: 'immediately' or 'next_billing_period'
   */
  async cancelSubscription(
    subscriptionId: string,
    effectiveFrom: 'immediately' | 'next_billing_period' = 'next_billing_period'
  ) {
    try {
      const result = await this.paddle.subscriptions.cancel(subscriptionId, {
        effectiveFrom,
      });
      return result;
    } catch (err) {
      console.error('[PaddleService] Error canceling subscription:', err);
      throw err;
    }
  }

  /**
   * Pause subscription in Paddle
   */
  async pauseSubscription(subscriptionId: string) {
    try {
      const result = await this.paddle.subscriptions.pause(subscriptionId, {
        effectiveFrom: 'next_billing_period',
      });
      return result;
    } catch (err) {
      console.error('[PaddleService] Error pausing subscription:', err);
      throw err;
    }
  }

  /**
   * Resume paused subscription
   */
  async resumeSubscription(subscriptionId: string) {
    try {
      const result = await this.paddle.subscriptions.resume(subscriptionId, {
        effectiveFrom: 'immediately',
      });
      return result;
    } catch (err) {
      console.error('[PaddleService] Error resuming subscription:', err);
      throw err;
    }
  }

  /**
   * Get update payment method URL
   */
  async getUpdatePaymentMethodUrl(subscriptionId: string): Promise<string> {
    try {
      const transaction = await this.paddle.subscriptions.getPaymentMethodChangeTransaction(
        subscriptionId
      );

      // Return the payment method update URL
      // Paddle returns a checkout object with a URL
      return (transaction as any).checkout?.url || '';
    } catch (err) {
      console.error('[PaddleService] Error getting update payment method URL:', err);
      throw err;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    signature: string,
    rawBody: string,
    webhookSecret: string
  ): boolean {
    try {
      // Paddle webhook signature verification
      // The signature is in format: ts=<timestamp>;h1=<signature>
      const parts = signature.split(';');
      const timestamp = parts.find((p) => p.startsWith('ts='))?.split('=')[1];
      const hash = parts.find((p) => p.startsWith('h1='))?.split('=')[1];

      if (!timestamp || !hash) {
        return false;
      }

      // Create verification string: timestamp:rawBody
      const signedPayload = `${timestamp}:${rawBody}`;

      // Create HMAC SHA256 hash
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(signedPayload);
      const expectedHash = hmac.digest('hex');

      // Compare hashes (constant-time comparison)
      return crypto.timingSafeEqual(
        Buffer.from(hash),
        Buffer.from(expectedHash)
      );
    } catch (err) {
      console.error('[PaddleService] Error verifying webhook signature:', err);
      return false;
    }
  }

  /**
   * Get customer details
   */
  async getCustomer(customerId: string) {
    try {
      const customer = await this.paddle.customers.get(customerId);
      return customer;
    } catch (err) {
      console.error('[PaddleService] Error getting customer:', err);
      throw err;
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(transactionId: string) {
    try {
      const transaction = await this.paddle.transactions.get(transactionId);
      return transaction;
    } catch (err) {
      console.error('[PaddleService] Error getting transaction:', err);
      throw err;
    }
  }

  /**
   * List prices for a product
   */
  async getPricesForProduct(productId: string) {
    try {
      const prices = await this.paddle.prices.list({
        productId: [productId],
      });
      // Convert iterator to array
      const pricesArray = [];
      for await (const price of prices) {
        pricesArray.push(price);
      }
      return pricesArray;
    } catch (err) {
      console.error('[PaddleService] Error getting prices:', err);
      throw err;
    }
  }
}
