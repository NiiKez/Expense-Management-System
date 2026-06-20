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
