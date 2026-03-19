import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler, AppError } from '../error-handler.js';

function createApp(routeHandler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.get('/test', routeHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler middleware', () => {
  it('returns ApiError format for AppError', async () => {
    const app = createApp((_req, _res, next) => {
      next(new AppError(400, 'VALIDATION_ERROR', '入力内容に誤りがあります', { name: '必須です' }));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: { name: '必須です' },
    });
  });

  it('returns 500 with INTERNAL_ERROR for unknown errors', async () => {
    const app = createApp((_req, _res, next) => {
      next(new Error('something broke'));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバーエラーが発生しました',
    });
  });

  it('omits details when AppError has no details', async () => {
    const app = createApp((_req, _res, next) => {
      next(new AppError(404, 'NOT_FOUND', '見つかりません'));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: '見つかりません',
    });
    expect(res.body.details).toBeUndefined();
  });

  it('does not interfere when headers are already sent', async () => {
    const app = createApp((_req, res, next) => {
      res.status(200).json({ ok: true });
      next(new Error('late error'));
    });

    const res = await request(app).get('/test');

    // The original response should come through, not the error handler
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
