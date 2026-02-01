/**
 * TypeScript types for subscription and billing functionality
 */

// ============================================================================
// Subscription Plan Types
// ============================================================================

export type BillingCycle = 'month' | 'year' | 'one_time';

export type PlanName = 'Monthly' | 'Yearly' | 'Lifetime';

export interface SubscriptionPlan {
  id: string;
  paddle_product_id: string;
  paddle_price_id: string;
  name: PlanName;
  billing_cycle: BillingCycle;
  price_amount: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// User Subscription Types
// ============================================================================

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'paused'
  | 'canceled'
  | 'expired';

export interface UserSubscription {
  id: string;
  user_id: string;
  is_beta_tester: boolean;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  plan_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null; // NULL for lifetime
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSubscriptionWithPlan extends UserSubscription {
  plan: SubscriptionPlan | null;
}

// ============================================================================
// Payment Event Types
// ============================================================================

export interface PaymentEvent {
  id: string;
  user_id: string | null;
  paddle_event_id: string;
  event_type: string;
  event_data: Record<string, any>;
  processed: boolean;
  error_message: string | null;
  created_at: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface SubscriptionStatusResponse {
  hasAccess: boolean;
  isBetaTester: boolean;
  subscription: {
    status: SubscriptionStatus;
    planName: PlanName | null;
    billingCycle: BillingCycle | null;
    currentPeriodEnd: string | null;
    canceledAt: string | null;
  } | null;
}

export interface CheckoutRequest {
  planId: string; // Plan name: 'Monthly', 'Yearly', or 'Lifetime'
  successUrl?: string;
  customData?: Record<string, any>;
}

export interface CheckoutResponse {
  checkoutUrl: string;
}

export interface CancelSubscriptionRequest {
  immediate?: boolean; // Cancel immediately vs at period end
}

export interface CancelSubscriptionResponse {
  success: boolean;
  canceledAt: string;
  accessUntil: string | null; // NULL for immediate cancellation
}

export interface UpdatePaymentResponse {
  updateUrl: string;
}

export interface PlansResponse {
  plans: Array<{
    id: string;
    name: PlanName;
    billingCycle: BillingCycle;
    priceAmount: number;
    currency: string;
    paddleProductId: string;
    paddlePriceId: string;
  }>;
}

// ============================================================================
// Paddle Webhook Types
// ============================================================================

export interface PaddleWebhookEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, any>;
}

export interface PaddleSubscriptionCreatedData {
  id: string;
  status: string;
  customer_id: string;
  items: Array<{
    price: {
      id: string;
      product_id: string;
    };
  }>;
  custom_data?: {
    user_id?: string;
  };
  current_billing_period?: {
    starts_at: string;
    ends_at: string;
  };
}

export interface PaddleTransactionCompletedData {
  id: string;
  status: string;
  customer_id: string;
  items: Array<{
    price: {
      id: string;
      product_id: string;
    };
  }>;
  custom_data?: {
    user_id?: string;
  };
}

// ============================================================================
// Service Layer Types
// ============================================================================

export interface CreateSubscriptionParams {
  userId: string;
  paddleCustomerId: string;
  paddleSubscriptionId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
}

export interface UpdateSubscriptionParams {
  paddleSubscriptionId: string;
  status?: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string | null;
  canceledAt?: string | null;
}
