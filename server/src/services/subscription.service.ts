/**
 * Subscription Service
 * Handles all database operations related to subscriptions
 */

import { supabase } from './supabase.service';
import type {
  UserSubscription,
  UserSubscriptionWithPlan,
  SubscriptionPlan,
  SubscriptionStatus,
  CreateSubscriptionParams,
  UpdateSubscriptionParams,
  PaymentEvent,
} from '../types/subscription.types';

export class SubscriptionService {
  /**
   * Check if user has active subscription (beta tester OR active status)
   */
  async hasActiveSubscription(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('has_active_subscription', {
        user_uuid: userId,
      });

      if (error) {
        console.error('[SubscriptionService] Error checking subscription:', error);
        return false;
      }

      return data === true;
    } catch (err) {
      console.error('[SubscriptionService] Exception checking subscription:', err);
      return false;
    }
  }

  /**
   * Get user subscription with plan details
   */
  async getUserSubscription(
    userId: string
  ): Promise<UserSubscriptionWithPlan | null> {
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(
          `
          *,
          plan:subscription_plans(*)
        `
        )
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No subscription found
          return null;
        }
        throw error;
      }

      return data as UserSubscriptionWithPlan;
    } catch (err) {
      console.error('[SubscriptionService] Error getting subscription:', err);
      throw err;
    }
  }

  /**
   * Get subscription by Paddle subscription ID
   */
  async getSubscriptionByPaddleId(
    paddleSubscriptionId: string
  ): Promise<UserSubscription | null> {
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('paddle_subscription_id', paddleSubscriptionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data as UserSubscription;
    } catch (err) {
      console.error('[SubscriptionService] Error getting subscription by Paddle ID:', err);
      throw err;
    }
  }

  /**
   * Get all subscription plans
   */
  async getPlans(): Promise<SubscriptionPlan[]> {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('price_amount', { ascending: true });

      if (error) throw error;

      return (data as SubscriptionPlan[]) || [];
    } catch (err) {
      console.error('[SubscriptionService] Error getting plans:', err);
      throw err;
    }
  }

  /**
   * Get plan by name
   */
  async getPlanByName(name: string): Promise<SubscriptionPlan | null> {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('name', name)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data as SubscriptionPlan;
    } catch (err) {
      console.error('[SubscriptionService] Error getting plan:', err);
      throw err;
    }
  }

  /**
   * Get plan by Paddle product ID
   */
  async getPlanByPaddleProductId(
    paddleProductId: string
  ): Promise<SubscriptionPlan | null> {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('paddle_product_id', paddleProductId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data as SubscriptionPlan;
    } catch (err) {
      console.error('[SubscriptionService] Error getting plan by Paddle product ID:', err);
      throw err;
    }
  }

  /**
   * Create new subscription
   */
  async createSubscription(
    params: CreateSubscriptionParams
  ): Promise<UserSubscription> {
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .insert({
          user_id: params.userId,
          paddle_customer_id: params.paddleCustomerId,
          paddle_subscription_id: params.paddleSubscriptionId,
          plan_id: params.planId,
          status: params.status,
          current_period_start: params.currentPeriodStart,
          current_period_end: params.currentPeriodEnd,
        })
        .select()
        .single();

      if (error) throw error;

      return data as UserSubscription;
    } catch (err) {
      console.error('[SubscriptionService] Error creating subscription:', err);
      throw err;
    }
  }

  /**
   * Update existing subscription
   */
  async updateSubscription(
    params: UpdateSubscriptionParams
  ): Promise<UserSubscription> {
    try {
      const updates: Partial<UserSubscription> = {};

      if (params.status !== undefined) updates.status = params.status;
      if (params.currentPeriodStart !== undefined)
        updates.current_period_start = params.currentPeriodStart;
      if (params.currentPeriodEnd !== undefined)
        updates.current_period_end = params.currentPeriodEnd;
      if (params.canceledAt !== undefined) updates.canceled_at = params.canceledAt;

      const { data, error } = await supabase
        .from('user_subscriptions')
        .update(updates)
        .eq('paddle_subscription_id', params.paddleSubscriptionId)
        .select()
        .single();

      if (error) throw error;

      return data as UserSubscription;
    } catch (err) {
      console.error('[SubscriptionService] Error updating subscription:', err);
      throw err;
    }
  }

  /**
   * Cancel subscription (mark as canceled but keep access until period end)
   */
  async cancelSubscription(userId: string): Promise<UserSubscription> {
    try {
      const { data, error} = await supabase
        .from('user_subscriptions')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return data as UserSubscription;
    } catch (err) {
      console.error('[SubscriptionService] Error canceling subscription:', err);
      throw err;
    }
  }

  /**
   * Log payment event from Paddle webhook
   */
  async logPaymentEvent(
    eventId: string,
    eventType: string,
    eventData: Record<string, any>,
    userId: string | null = null
  ): Promise<PaymentEvent> {
    try {
      const { data, error } = await supabase
        .from('payment_events')
        .insert({
          paddle_event_id: eventId,
          event_type: eventType,
          event_data: eventData,
          user_id: userId,
          processed: false,
        })
        .select()
        .single();

      if (error) {
        // If duplicate event_id, ignore (idempotency)
        if (error.code === '23505') {
          console.log(`[SubscriptionService] Duplicate event ${eventId}, skipping`);
          const { data: existing } = await supabase
            .from('payment_events')
            .select('*')
            .eq('paddle_event_id', eventId)
            .single();
          return existing as PaymentEvent;
        }
        throw error;
      }

      return data as PaymentEvent;
    } catch (err) {
      console.error('[SubscriptionService] Error logging payment event:', err);
      throw err;
    }
  }

  /**
   * Mark payment event as processed
   */
  async markEventProcessed(
    eventId: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      const updates: any = {
        processed: true,
      };

      if (errorMessage) {
        updates.error_message = errorMessage;
      }

      const { error } = await supabase
        .from('payment_events')
        .update(updates)
        .eq('paddle_event_id', eventId);

      if (error) throw error;
    } catch (err) {
      console.error('[SubscriptionService] Error marking event processed:', err);
      throw err;
    }
  }

  /**
   * Get all subscriptions (for admin dashboard)
   */
  async getAllSubscriptions(): Promise<UserSubscriptionWithPlan[]> {
    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select(
          `
          *,
          plan:subscription_plans(*)
        `
        )
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data as UserSubscriptionWithPlan[]) || [];
    } catch (err) {
      console.error('[SubscriptionService] Error getting all subscriptions:', err);
      throw err;
    }
  }
}
