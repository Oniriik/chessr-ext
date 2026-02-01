/**
 * Environment configuration loader
 * This file MUST be imported first before any other modules
 */
import dotenv from 'dotenv';
import { join } from 'path';

// Load from server/.env.local (process.cwd() points to server directory)
const envPath = join(process.cwd(), '.env.local');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`[Env] Warning: Could not load ${envPath}`);
  console.warn('[Env] Using system environment variables only');
} else {
  console.log(`[Env] ✓ Loaded from ${envPath}`);
}

// Export nothing - this file only needs to be imported for side effects
export {};
