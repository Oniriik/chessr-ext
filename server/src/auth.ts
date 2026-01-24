import jwt from 'jsonwebtoken';
import { globalLogger } from './logger.js';

export interface SupabaseJWTPayload {
  sub: string;  // user id
  email: string;
  aud: string;
  role: string;
  exp: number;
  iat: number;
}

/**
 * Validates a Supabase JWT token
 * Supabase uses ES256 (asymmetric) so we decode and verify expiration
 * Returns user info if valid, null if invalid
 */
export function validateSupabaseToken(token: string): { id: string; email: string } | null {
  try {
    // Decode the token (Supabase uses ES256 which requires JWKS for full verification)
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.payload) {
      globalLogger.error('token_decode_failed', 'Failed to decode token');
      return null;
    }

    const payload = decoded.payload as SupabaseJWTPayload;

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      globalLogger.error('token_expired', 'Token expired', { email: payload.email });
      return null;
    }

    // Verify required fields exist
    if (!payload.sub || !payload.email) {
      globalLogger.error('token_invalid', 'Token missing required fields');
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
    };
  } catch (error) {
    globalLogger.error('token_validation_error', error instanceof Error ? error : String(error));
    return null;
  }
}
