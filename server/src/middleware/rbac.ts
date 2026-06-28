import { Request, Response, NextFunction } from 'express';
import { Role } from '../types';
import { forbidden, unauthorized } from '../utils/errors';

export const authorize = (allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
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
    next(forbidden('This action is not available in demo mode'));
    return;
  }
  next();
};
