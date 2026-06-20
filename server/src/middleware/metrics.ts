import { Request, Response, NextFunction } from 'express';
import { apiRequestDurationSeconds, apiErrorsTotal } from '../services/metricsService';

/**
 * Normalize Express route paths so metrics don't explode with cardinality.
 * E.g. /api/v1/expenses/42 → /api/v1/expenses/:id.
 * Why: returning req.path for unmatched routes (404s, attacker probes) creates
 * one Prometheus series per unique URL — Prometheus runs out of memory.
 */
function getRoutePath(req: Request): string {
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }
  return 'unmatched';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = getRoutePath(req);
    const status = String(res.statusCode);

    apiRequestDurationSeconds.labels(req.method, route, status).observe(durationSec);

    if (res.statusCode >= 400) {
      apiErrorsTotal.labels(status, route).inc();
    }
  });

  next();
}
