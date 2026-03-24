import { Router, type Request, type Response } from 'express';
import { RegisterSchema, LoginSchema } from '@picture-book/shared';
import { registerUser, loginUser, AuthError } from '../services/auth-service.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = Router();

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await registerUser(parsed.data.email, parsed.data.password);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === 'EMAIL_EXISTS' ? 409 : 400;
      res.status(status).json({ code: err.code, message: err.message });
      return;
    }
    console.error('Register error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' });
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await loginUser(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === 'ACCOUNT_LOCKED' ? 423 : 401;
      res.status(status).json({ code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' });
  }
});

// POST /api/auth/logout
authRouter.post('/logout', authMiddleware, (_req: Request, res: Response) => {
  // JWT is stateless — client discards the token.
  // This endpoint exists for API completeness and future token-blacklist support.
  res.json({ message: 'ログアウトしました' });
});
