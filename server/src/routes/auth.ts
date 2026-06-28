import { Router, Request, Response, NextFunction } from 'express';
import { isDemoEnabled } from '../config/demo';
import { canCreateDemoWorkspace, createDemoWorkspace, signDemoToken } from '../services/demoService';
import { AppError, forbidden } from '../utils/errors';
import logger from '../config/logger';

const router = Router();

/**
 * POST /api/v1/auth/demo-login
 *
 * Public, unauthenticated. Provisions a fresh, isolated demo workspace and
 * returns a short-lived demo session token. Disabled unless ENABLE_DEMO=true
 * (and DEMO_JWT_SECRET is set). The token is then sent as a normal
 * `Authorization: Bearer <token>` and recognized by the auth middleware.
 */
export const demoLogin = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!isDemoEnabled()) {
      next(forbidden('Demo mode is not enabled'));
      return;
    }

    if (!(await canCreateDemoWorkspace())) {
      next(new AppError(503, 'The demo is at capacity right now. Please try again shortly.'));
      return;
    }

    const workspace = await createDemoWorkspace();
    const token = signDemoToken(workspace.userId, workspace.role);

    logger.info('Demo session issued', { userId: workspace.userId });

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: workspace.userId,
          role: workspace.role,
          email: workspace.email,
          display_name: workspace.display_name,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

router.post('/demo-login', demoLogin);

export default router;
