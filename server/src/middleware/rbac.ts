import { Request, Response, NextFunction } from 'express';
import { Role, SecurityEventType, SecurityOutcome } from '../types';
import { forbidden, unauthorized } from '../utils/errors';
import { securityEventModel } from '../models/securityEvent';

// Record an authorization denial to the durable security trail. Fire-and-forget:
// record() is best-effort and never throws, so it stays off the request path and
// out of the (synchronous) middleware signature. Bounded by the per-route rate
// limiter, so a probing caller cannot flood the table.
function recordAccessDenied(req: Request, detail: string): void {
  void securityEventModel.record({
    event_type: SecurityEventType.ACCESS_DENIED,
    outcome: SecurityOutcome.FAILURE,
    user_id: req.user?.id ?? null,
    role: req.user?.role ?? null,
    ip_address: req.ip ?? null,
    request_id: req.id ?? null,
    detail,
    metadata: { method: req.method, path: req.originalUrl },
  });
}

export const authorize = (allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      recordAccessDenied(req, `Role ${req.user.role} not permitted (requires ${allowedRoles.join('/') || 'none'})`);
      next(forbidden());
      return;
    }

    next();
  };
};

// Hard stop for demo sandbox sessions on privileged surfaces. RBAC already keeps
// a MANAGER-role demo user out of ADMIN-only routes; this makes the intent
// explicit and stays correct if such a route's role requirement ever changes.
export const denyDemo = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.user?.demoMode) {
    recordAccessDenied(req, 'Demo session blocked from a privileged action');
    next(forbidden('This action is not available in demo mode'));
    return;
  }
  next();
};

/**
 * Resolve the demo-workspace scope for a read query.
 *
 * Returns the caller's demo_session_id when this is a demo session (so the
 * model can constrain results to that one workspace), or undefined for a real
 * admin (whose queries stay org-wide / unchanged). Throws 403 if a demo session
 * somehow lacks a workspace id — an unscoped admin query must NEVER run for a
 * demo caller, as that would leak real or other demo workspaces' data.
 */
export const demoScope = (req: Request): string | undefined => {
  if (!req.user?.demoMode) return undefined;
  const sessionId = req.user.demoSessionId;
  if (!sessionId) {
    throw forbidden('This action is not available in demo mode');
  }
  return sessionId;
};
