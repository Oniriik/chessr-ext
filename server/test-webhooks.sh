#!/bin/bash

# Test webhook scripts for local development
# Make sure SKIP_WEBHOOK_VERIFICATION=true in .env.local

API_URL="http://localhost:3002"
USER_ID="your-user-id-here"  # Replace with a real Supabase user ID

echo "🧪 Testing Paddle Webhooks locally..."
echo ""

# Test 1: subscription.created (Monthly)
echo "1️⃣  Testing subscription.created (Monthly)..."
curl -X POST $API_URL/api/webhooks/paddle \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"evt_test_$(date +%s)\",
    \"event_type\": \"subscription.created\",
    \"occurred_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"data\": {
      \"id\": \"sub_test_monthly_$(date +%s)\",
      \"status\": \"active\",
      \"customer_id\": \"ctm_test_123\",
      \"items\": [{
        \"price\": {
          \"id\": \"pri_monthly_placeholder\",
          \"product_id\": \"prod_monthly_placeholder\"
        }
      }],
      \"custom_data\": {
        \"user_id\": \"$USER_ID\"
      },
      \"current_billing_period\": {
        \"starts_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"ends_at\": \"$(date -u -v+1m +%Y-%m-%dT%H:%M:%SZ)\"
      }
    }
  }"
echo -e "\n"

# Test 2: transaction.completed (Lifetime)
echo "2️⃣  Testing transaction.completed (Lifetime)..."
curl -X POST $API_URL/api/webhooks/paddle \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"evt_test_$(date +%s)\",
    \"event_type\": \"transaction.completed\",
    \"occurred_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"data\": {
      \"id\": \"txn_test_lifetime_$(date +%s)\",
      \"status\": \"completed\",
      \"customer_id\": \"ctm_test_456\",
      \"items\": [{
        \"price\": {
          \"id\": \"pri_lifetime_placeholder\",
          \"product_id\": \"prod_lifetime_placeholder\"
        }
      }],
      \"custom_data\": {
        \"user_id\": \"$USER_ID\"
      }
    }
  }"
echo -e "\n"

# Test 3: subscription.canceled
echo "3️⃣  Testing subscription.canceled..."
curl -X POST $API_URL/api/webhooks/paddle \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"evt_test_$(date +%s)\",
    \"event_type\": \"subscription.canceled\",
    \"occurred_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"data\": {
      \"id\": \"sub_test_monthly_cancel\"
    }
  }"
echo -e "\n"

# Test 4: transaction.payment_failed
echo "4️⃣  Testing transaction.payment_failed..."
curl -X POST $API_URL/api/webhooks/paddle \
  -H "Content-Type: application/json" \
  -d "{
    \"event_id\": \"evt_test_$(date +%s)\",
    \"event_type\": \"transaction.payment_failed\",
    \"occurred_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"data\": {
      \"subscription_id\": \"sub_test_monthly_fail\"
    }
  }"
echo -e "\n"

echo "✅ All webhook tests sent!"
echo ""
echo "Check the server logs and Supabase database:"
echo "  - user_subscriptions table"
echo "  - payment_events table"
