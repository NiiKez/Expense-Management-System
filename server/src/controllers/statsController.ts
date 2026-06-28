import { Request, Response, NextFunction } from 'express';
import { statsModel } from '../models/stats';
import { demoScope } from '../middleware/rbac';

export const getMyStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await statsModel.getUserStats(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

export const getManagerStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await statsModel.getTeamStats(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

export const getAdminStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Demo sessions get aggregates scoped to their own workspace, not org-wide.
    const data = await statsModel.getOrgStats(demoScope(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
};
