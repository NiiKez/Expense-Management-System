import { Request, Response, NextFunction } from 'express';
import { graphApiService, isGraphApiAuthError } from '../services/graphApi';
import { userModel } from '../models/user';
import logger from '../config/logger';
import { summarizeHttpError } from '../utils/logSanitizer';
import { getSingleQueryValue } from '../utils/requestParsing';

interface ManagerEmployeeRecord {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  appUser: {
    id: number;
    email: string;
    display_name: string;
    role: string;
    manager_id: number | null;
    is_active: boolean;
  } | null;
}

function getBearerToken(req: Request): string {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return '';
  }

  return header.slice(7);
}

export const getManagerEmployees = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const forceRefresh = getSingleQueryValue(req.query.forceRefresh, 'forceRefresh') === 'true';
    const token = getBearerToken(req);

    const respondFromDatabase = async (reason: 'missing_token' | 'graph_unavailable' | 'graph_consent_required' | 'graph_no_direct_reports') => {
      const employees = await userModel.findByManagerId(req.user!.id);
      const data: ManagerEmployeeRecord[] = employees.map((employee) => ({
        id: employee.entra_id,
        displayName: employee.display_name,
        mail: employee.email,
        userPrincipalName: employee.email,
        appUser: {
          id: employee.id,
          email: employee.email,
          display_name: employee.display_name,
          role: employee.role,
          manager_id: employee.manager_id,
          is_active: employee.is_active,
        },
      }));

      res.json({
        success: true,
        data,
        meta: {
          source: 'database',
          reason,
          forceRefresh,
        },
      });
    };

    if (!token) {
      await respondFromDatabase('missing_token');
      return;
    }

    try {
      const directReports = await graphApiService.getDirectReports(req.user!.id, token, { forceRefresh });

      if (directReports.length === 0) {
        await respondFromDatabase('graph_no_direct_reports');
        return;
      }

      const matchedUsers = await userModel.findByEntraIds(directReports.map((report) => report.id));
      const matchedByEntraId = new Map(matchedUsers.map((user) => [user.entra_id, user]));

      await Promise.all(
        matchedUsers
          .filter((user) => user.manager_id !== req.user!.id)
          .map((user) => userModel.updateManager(user.id, req.user!.id)),
      );

      const data: ManagerEmployeeRecord[] = directReports.map((report) => {
        const appUser = matchedByEntraId.get(report.id);

        return {
          ...report,
          appUser: appUser ? {
            id: appUser.id,
            email: appUser.email,
            display_name: appUser.display_name,
            role: appUser.role,
            manager_id: req.user!.id,
            is_active: appUser.is_active,
          } : null,
        };
      });

      res.json({
        success: true,
        data,
        meta: {
          source: 'graph',
          forceRefresh,
        },
      });
    } catch (err) {
      logger.warn('Falling back to database-backed employees after Graph API failure', {
        err: summarizeHttpError(err),
        managerId: req.user!.id,
        forceRefresh,
      });
      await respondFromDatabase(isGraphApiAuthError(err) && err.reason === 'consent_required'
        ? 'graph_consent_required'
        : 'graph_unavailable');
    }
  } catch (err) {
    next(err);
  }
};
