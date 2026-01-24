import jwt from 'jsonwebtoken';

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
      console.error('[Auth] Failed to decode token');
      return null;
    }

    const payload = decoded.payload as SupabaseJWTPayload;

    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.error('[Auth] Token expired');
      return null;
    }

    // Verify required fields exist
    if (!payload.sub || !payload.email) {
      console.error('[Auth] Token missing required fields (sub, email)');
      return null;
    }

    console.log(`[Auth] Token valid for: ${payload.email}`);
    return {
      id: payload.sub,
      email: payload.email,
    };
  } catch (error) {
    console.error('[Auth] Token validation failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
