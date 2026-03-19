import type { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthError, type AuthTokenPayload } from '../services/auth-service.js';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: '認証が必要です',
    });
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({
        code: err.code,
        message: err.message,
      });
      return;
    }
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: '認証に失敗しました',
    });
  }
}
