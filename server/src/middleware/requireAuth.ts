/**
 * BiblioVault AI — Authentication Middleware
 * Extracts JWT from HttpOnly cookie, validates it, and injects userId into the request.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, COOKIE_NAME, type JwtPayload } from '../auth.js';

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userPlan?: string;
    }
  }
}

/**
 * Middleware that REQUIRES authentication.
 * Returns 401 if no valid JWT is present.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  
  if (!token) {
    res.status(401).json({ error: 'Autenticación requerida. Inicia sesión.' });
    return;
  }

  const payload = verifyJWT(token);
  if (!payload) {
    res.status(401).json({ error: 'Sesión expirada. Inicia sesión de nuevo.' });
    return;
  }

  // Inject user info into request
  req.userId = payload.userId;
  req.userEmail = payload.email;
  req.userPlan = payload.plan;
  
  next();
}

/**
 * Middleware that OPTIONALLY extracts auth info.
 * Does NOT block unauthenticated requests — useful for public endpoints
 * that behave differently when a user is logged in.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  
  if (token) {
    const payload = verifyJWT(token);
    if (payload) {
      req.userId = payload.userId;
      req.userEmail = payload.email;
      req.userPlan = payload.plan;
    }
  }
  
  next();
}
