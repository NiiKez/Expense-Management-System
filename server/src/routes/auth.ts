import { Router, Request, Response, NextFunction } from 'express';
import { isDemoEnabled } from '../config/demo';
import { canCreateDemoWorkspace, createDemoWorkspace, signDemoToken } from '../services/demoService';
import { AppError, forbidden } from '../utils/errors';
import { securityEventModel } from '../models/securityEvent';
import { Role, SecurityEventType, SecurityOutcome } from '../types';

const router = Router();

// Roles a visitor may pick on the demo login page. Matched case-sensitively
// against the Role enum; anything else falls back to MANAGER.
const DEMO_ROLES: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.EMPLOYEE];

function resolveRequestedDemoRole(body: unknown): Role {
  const requested = (body as { role?: unknown } | null | undefined)?.role;
  return typeof requested === 'string' && (DEMO_ROLES as readonly string[]).includes(requested)
    ? (requested as Role)
    : Role.MANAGER;
}

/**
 * POST /api/v1/auth/demo-login
 *
 * Public, unauthenticated. Provisions a fresh, isolated demo workspace and
 * returns a short-lived demo session token. Disabled unless ENABLE_DEMO=true
 * (and DEMO_JWT_SECRET is set). The token is then sent as a normal
 * `Authorization: Bearer <token>` and recognized by the auth middleware.
 */
export const demoLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isDemoEnabled()) {
      next(forbidden('Demo mode is not enabled'));
      return;
    }

    if (!(await canCreateDemoWorkspace())) {
      next(new AppError(503, 'The demo is at capacity right now. Please try again shortly.'));
      return;
    }

    const role = resolveRequestedDemoRole(req.body);
    const workspace = await createDemoWorkspace();
    const userId = workspace.usersByRole[role];
    const token = signDemoToken(userId, role);

    await securityEventModel.record({
      event_type: SecurityEventType.DEMO_SESSION_ISSUED,
      outcome: SecurityOutcome.SUCCESS,
      user_id: userId,
      role,
      ip_address: req.ip ?? null,
      request_id: req.id ?? null,
      detail: `Public demo workspace provisioned (role: ${role})`,
    });

    res.status(201).json({
      success: true,
      data: { token },
    });
  } catch (err) {
    next(err);
  }
};

router.post('/demo-login', demoLogin);

export default router;
