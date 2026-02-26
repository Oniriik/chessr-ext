-- Migration: Add country resolution to signup_ips
-- Purpose: Store resolved country from IP geolocation for signup notifications

ALTER TABLE signup_ips ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE signup_ips ADD COLUMN IF NOT EXISTS country_code TEXT;
