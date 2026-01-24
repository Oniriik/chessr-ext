import jwt from 'jsonwebtoken';

const SUPABASE_URL = 'https://ratngdlkcvyfdmidtenx.supabase.co';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

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
 * Returns user info if valid, null if invalid
 */
export function validateSupabaseToken(token: string): { id: string; email: string } | null {
  try {
    // For Supabase, we can verify using the JWT secret from Supabase settings
    // The secret can be found in Supabase Dashboard -> Settings -> API -> JWT Secret

    if (!SUPABASE_JWT_SECRET) {
      console.warn('[Auth] SUPABASE_JWT_SECRET not set, skipping token validation');
      return null;
    }

    // Decode without verification first to see the header/payload
    const decoded = jwt.decode(token, { complete: true });
    if (decoded) {
      console.log('[Auth] Token header:', decoded.header);
      console.log('[Auth] Token payload email:', (decoded.payload as any).email);
    }

    const verified = jwt.verify(token, SUPABASE_JWT_SECRET, {
      algorithms: ['HS256'],
    }) as SupabaseJWTPayload;

    return {
      id: verified.sub,
      email: verified.email,
    };
  } catch (error) {
    console.error('[Auth] Token validation failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Alternative: Fetch JWKS from Supabase and verify using public key
 * This is more secure but requires fetching JWKS on startup or caching
 */
export async function validateSupabaseTokenWithJWKS(token: string): Promise<{ id: string; email: string } | null> {
  try {
    // Decode without verification first to get header
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      return null;
    }

    // For now, using JWT secret is simpler
    // In production, consider using jwks-rsa library for public key verification
    return validateSupabaseToken(token);
  } catch (error) {
    console.error('[Auth] JWKS validation failed:', error);
    return null;
  }
}
