import { Request, Response, NextFunction } from 'express';
import { expenseModel } from '../models/expense';
import { Status, Role } from '../types';
import { notFound, forbidden, conflict } from '../utils/errors';
import { userModel } from '../models/user';
import { graphApiService, isGraphApiAuthError } from '../services/graphApi';
import logger from '../config/logger';
import { expenseApprovalsTotal, expenseResolutionSeconds } from '../services/metricsService';
import { summarizeHttpError } from '../utils/logSanitizer';
import { getBearerToken, verifyManagerRelationship } from '../services/managerAuthorization';
import { notificationService } from '../services/notificationService';
import { parsePagination } from '../utils/pagination';
import { parsePositiveId } from '../utils/requestParsing';

export const getPendingApprovals = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const respondFromDatabase = async (reason: 'missing_token' | 'graph_unavailable' | 'graph_consent_required' | 'graph_no_direct_reports') => {
      const fallback = await expenseModel.findPendingByManagerId(req.user!.id, { page, pageSize });
      res.json({
        success: true,
        data: fallback.data,
        pagination: {
          total: fallback.total,
          page,
          pageSize,
        },
        meta: {
          source: 'database',
          reason,
        },
      });
    };

    if (req.user!.role === Role.ADMIN) {
      const result = await expenseModel.findAll({ status: Status.PENDING, page, pageSize });

      res.json({
        success: true,
        data: result.data,
        pagination: {
          total: result.total,
          page,
          pageSize,
        },
      });
      return;
    }

    const token = getBearerToken(req);
    if (!token) {
      await respondFromDatabase('missing_token');
      return;
    }

    try {
      const directReports = await graphApiService.getDirectReports(req.user!.id, token);

      // Graph succeeded but returned no direct reports — fall back to the
      // database so expenses from users whose manager_id already points to
      // this manager (or is NULL) are still visible.
      if (directReports.length === 0) {
        await respondFromDatabase('graph_no_direct_reports');
        return;
      }

      const subordinateUsers = await userModel.findByEntraIds(directReports.map((report) => report.id));

      await Promise.all(
        subordinateUsers
          .filter((user) => user.manager_id !== req.user!.id)
          .map((user) => userModel.updateManager(user.id, req.user!.id)),
      );

      const subordinateIds = subordinateUsers
        .map((user) => user.id)
        .filter((id) => id !== req.user!.id);

      const result = await expenseModel.findPendingBySubmitterIds(subordinateIds, { page, pageSize });

      res.json({
        success: true,
        data: result.data,
        pagination: {
          total: result.total,
          page,
          pageSize,
        },
        meta: {
          source: 'graph',
        },
      });
    } catch (err) {
      logger.warn('Falling back to database-backed approvals after Graph API failure', {
        err: summarizeHttpError(err),
        managerId: req.user!.id,
      });
      await respondFromDatabase(isGraphApiAuthError(err) && err.reason === 'consent_required'
        ? 'graph_consent_required'
        : 'graph_unavailable');
    }
  } catch (err) {
    next(err);
  }
};

export const approveExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    if (expense.status !== Status.PENDING) {
      next(conflict('Only pending expenses can be approved'));
      return;
    }

    if (expense.submitted_by === req.user!.id) {
      next(forbidden('You cannot approve your own expenses'));
      return;
    }

    // forceRefresh: true already bypasses the cache; no need to invalidate first.
    const relationship = await verifyManagerRelationship(req, expense.submitted_by, {
      allowCachedFallback: false,
      forceRefresh: true,
    });
    if (!relationship.allowed) {
      next(forbidden(relationship.reason!));
      return;
    }

    const resultCode = await expenseModel.approveWithVersion(
      expenseId,
      req.user!.id,
      expense.version,
      req.ip || null,
    );

    if (resultCode === 'VERSION_CONFLICT') {
      next(conflict('Expense was modified by another request. Please refresh and try again.'));
      return;
    }

    if (resultCode === 'NOT_PENDING') {
      next(conflict('Only pending expenses can be approved'));
      return;
    }

    if (resultCode !== 'SUCCESS') {
      next(notFound('Expense'));
      return;
    }

    expenseApprovalsTotal.labels('approved').inc();

    if (expense.created_at) {
      const submittedAt = new Date(expense.created_at).getTime();
      if (Number.isFinite(submittedAt)) {
        expenseResolutionSeconds.observe((Date.now() - submittedAt) / 1000);
      }
    }

    await notificationService.expenseDecision({ expense, actor: req.user!, decision: 'APPROVED' });

    const updated = await expenseModel.findById(expenseId);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

export const rejectExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    // Body shape is enforced by rejectExpenseSchema via validate() middleware.
    const trimmedReason: string = req.body.reason.trim();

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    if (expense.status !== Status.PENDING) {
      next(conflict('Only pending expenses can be rejected'));
      return;
    }

    if (expense.submitted_by === req.user!.id) {
      next(forbidden('You cannot reject your own expenses'));
      return;
    }

    const relationship = await verifyManagerRelationship(req, expense.submitted_by, {
      allowCachedFallback: false,
      forceRefresh: true,
    });
    if (!relationship.allowed) {
      next(forbidden(relationship.reason!));
      return;
    }

    const resultCode = await expenseModel.rejectWithVersion(
      expenseId,
      req.user!.id,
      expense.version,
      trimmedReason,
      req.ip || null,
    );

    if (resultCode === 'VERSION_CONFLICT') {
      next(conflict('Expense was modified by another request. Please refresh and try again.'));
      return;
    }

    if (resultCode === 'NOT_PENDING') {
      next(conflict('Only pending expenses can be rejected'));
      return;
    }

    if (resultCode !== 'SUCCESS') {
      next(notFound('Expense'));
      return;
    }

    expenseApprovalsTotal.labels('rejected').inc();

    if (expense.created_at) {
      const submittedAt = new Date(expense.created_at).getTime();
      if (Number.isFinite(submittedAt)) {
        expenseResolutionSeconds.observe((Date.now() - submittedAt) / 1000);
      }
    }

    await notificationService.expenseDecision({ expense, actor: req.user!, decision: 'REJECTED' });

    const updated = await expenseModel.findById(expenseId);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};
