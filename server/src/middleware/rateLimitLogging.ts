import { Request, Response, NextFunction } from 'express';
import type { Options, RateLimitInfo } from 'express-rate-limit';
import { SecurityEventType, SecurityOutcome } from '../types';
import { securityEventModel } from '../models/securityEvent';

/**
 * Shared express-rate-limit `handler`. Runs when a client is over its limit.
 *
 * Two jobs:
 *  1. Record a RATE_LIMIT_EXCEEDED security event — but ONLY on the first request
 *     that crosses the limit in a window (`used === limit + 1`). The handler fires
 *     for EVERY subsequent blocked request, so recording unconditionally would let
 *     a burst turn into a flood of DB writes — the exact load rate limiting exists
 *     to shed. record() is fire-and-forget and best-effort, so it never delays the
 *     429 nor throws into the response path.
 *  2. Send the app's standard JSON error shape (not the library's plain-text
 *     default), so a throttled client gets the same body contract as every other
 *     error. The RateLimit-* headers are already set by the limiter before this runs.
 */
export const rateLimitHandler = (
  req: Request,
  res: Response,
  _next: NextFunction,
  options: Options,
): void => {
  // express-rate-limit sets req[requestPropertyName] (default `rateLimit`) before
  // invoking the handler; it augments its own AugmentedRequest, not the global
  // Express.Request, so read it through a narrow cast.
  const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
  if (info && info.used === info.limit + 1) {
    void securityEventModel.record({
      event_type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      outcome: SecurityOutcome.FAILURE,
      user_id: req.user?.id ?? null,
      role: req.user?.role ?? null,
      ip_address: req.ip ?? null,
      request_id: req.id ?? null,
      detail: `Rate limit exceeded (${info.limit} per window)`,
      metadata: { method: req.method, path: req.originalUrl, limit: info.limit },
    });
  }

  res.status(options.statusCode).json({
    success: false,
    error: {
      message: 'Too many requests',
      statusCode: options.statusCode,
      requestId: req.id,
    },
  });
};
