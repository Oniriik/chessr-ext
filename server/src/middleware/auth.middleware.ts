/**
 * Auth Middleware
 * Validates JWT tokens for API requests
 */

import { Request, Response, NextFunction } from 'express';
import { validateSupabaseToken } from '../auth';

/**
 * Middleware to validate JWT token from Authorization header
 * Adds user info to req.user if valid
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing Authorization header',
      });
      return;
    }

    // Extract token from "Bearer <token>" format
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid Authorization header format. Expected: Bearer <token>',
      });
      return;
    }

    const token = parts[1];

    // Validate token using existing Supabase validation
    const userInfo = validateSupabaseToken(token);

    if (!userInfo) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      return;
    }

    // Add user info to request
    req.user = {
      id: userInfo.id,
      email: userInfo.email,
    };

    // Continue to next middleware/route handler
    next();
  } catch (err) {
    console.error('[AuthMiddleware] Error validating token:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate authentication',
    });
  }
}

/**
 * Optional auth middleware - doesn't fail if no token provided
 * Useful for endpoints that work with or without authentication
 */
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        const token = parts[1];
        const userInfo = validateSupabaseToken(token);

        if (userInfo) {
          req.user = {
            id: userInfo.id,
            email: userInfo.email,
          };
        }
      }
    }

    next();
  } catch (err) {
    console.error('[OptionalAuthMiddleware] Error validating token:', err);
    // Continue anyway
    next();
  }
}
