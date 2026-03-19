import type { Request, Response, NextFunction } from 'express';

/**
 * Standard API error response format.
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
}

/**
 * Application error class that maps to ApiError responses.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Global error handling middleware.
 * Catches unhandled errors from routes and returns a consistent ApiError response.
 * Must be registered as the LAST middleware in the Express app.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Already sent headers (e.g. SSE stream) — nothing we can do
  if (res.headersSent) {
    return;
  }

  // Known application error
  if (err instanceof AppError) {
    const body: ApiError = {
      code: err.code,
      message: err.message,
    };
    if (err.details) {
      body.details = err.details;
    }
    res.status(err.statusCode).json(body);
    return;
  }

  // Fallback for unexpected errors
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'サーバーエラーが発生しました',
  } satisfies ApiError);
}
