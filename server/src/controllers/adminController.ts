import { Request, Response, NextFunction } from 'express';
import { auditLogModel } from '../models/auditLog';
import { expenseModel } from '../models/expense';
import { userModel } from '../models/user';
import { AuditAction, Status, SecurityEventType, SecurityOutcome } from '../types';
import { securityEventModel } from '../models/securityEvent';
import { AUDIT_ACTIONS, CATEGORIES, STATUSES, EXPORT_MAX_ROWS } from '../utils/constants';
import { parsePagination } from '../utils/pagination';
import {
  parseDateQuery,
  parseEnumQuery,
  parsePositiveInteger,
  parseStringQuery,
} from '../utils/requestParsing';
import { toCsv, csvDate, csvTimestamp } from '../utils/csv';
import logger from '../config/logger';

const UTF8_BOM = '﻿';

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(UTF8_BOM + csv);
}

export const getAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { expense_id, performed_by, action, date_from, date_to, page, pageSize } = req.query;
    const parsedExpenseId = parsePositiveInteger(expense_id, 'expense_id');
    const parsedPerformedBy = parsePositiveInteger(performed_by, 'performed_by');
    const parsedAction = parseEnumQuery(action, 'action', AUDIT_ACTIONS) as AuditAction | undefined;
    const parsedDateFrom = parseDateQuery(date_from, 'date_from');
    const parsedDateTo = parseDateQuery(date_to, 'date_to');
    const parsedSort = parseStringQuery(req.query.sort, 'sort', { maxLength: 32 });
    const parsedOrder = parseStringQuery(req.query.order, 'order', { maxLength: 4 });

    const { page: parsedPage, pageSize: parsedPageSize } = parsePagination({
      page: page as string | string[] | undefined,
      pageSize: pageSize as string | string[] | undefined,
    });

    const result = await auditLogModel.findAll({
      expense_id: parsedExpenseId,
      performed_by: parsedPerformedBy,
      action: parsedAction,
      date_from: parsedDateFrom,
      date_to: parsedDateTo,
      sort: parsedSort,
      order: parsedOrder,
      page: parsedPage,
      pageSize: parsedPageSize,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: parsedPage,
        pageSize: parsedPageSize,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getAllExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, category, search, date_from, date_to, page, pageSize } = req.query;
    const parsedStatus = parseEnumQuery(status, 'status', STATUSES) as Status | undefined;
    const parsedCategory = parseEnumQuery(category, 'category', CATEGORIES);
    const parsedSearch = parseStringQuery(search, 'search', { maxLength: 100 });
    const parsedDateFrom = parseDateQuery(date_from, 'date_from');
    const parsedDateTo = parseDateQuery(date_to, 'date_to');
    const parsedSort = parseStringQuery(req.query.sort, 'sort', { maxLength: 32 });
    const parsedOrder = parseStringQuery(req.query.order, 'order', { maxLength: 4 });

    const { page: parsedPage, pageSize: parsedPageSize } = parsePagination({
      page: page as string | string[] | undefined,
      pageSize: pageSize as string | string[] | undefined,
    });

    const result = await expenseModel.findAll({
      status: parsedStatus,
      category: parsedCategory,
      search: parsedSearch,
      date_from: parsedDateFrom,
      date_to: parsedDateTo,
      sort: parsedSort,
      order: parsedOrder,
      page: parsedPage,
      pageSize: parsedPageSize,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: parsedPage,
        pageSize: parsedPageSize,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const exportAllExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, category, search, date_from, date_to } = req.query;
    const parsedStatus = parseEnumQuery(status, 'status', STATUSES) as Status | undefined;
    const parsedCategory = parseEnumQuery(category, 'category', CATEGORIES);
    const parsedSearch = parseStringQuery(search, 'search', { maxLength: 100 });
    const parsedDateFrom = parseDateQuery(date_from, 'date_from');
    const parsedDateTo = parseDateQuery(date_to, 'date_to');
    const parsedSort = parseStringQuery(req.query.sort, 'sort', { maxLength: 32 });
    const parsedOrder = parseStringQuery(req.query.order, 'order', { maxLength: 4 });

    const { data, capped } = await expenseModel.findAllForExport({
      status: parsedStatus,
      category: parsedCategory,
      search: parsedSearch,
      date_from: parsedDateFrom,
      date_to: parsedDateTo,
      sort: parsedSort,
      order: parsedOrder,
    });

    if (capped) {
      logger.warn('Admin expense export truncated at row cap', { cap: EXPORT_MAX_ROWS });
    }

    const csv = toCsv(
      ['ID', 'Title', 'Submitter', 'Submitter Email', 'Category', 'Amount', 'Currency', 'Date', 'Status', 'Filed'],
      data.map((e) => [
        e.id,
        e.title,
        e.submitter_name ?? '',
        e.submitter_email ?? '',
        e.category,
        e.amount,
        e.currency,
        csvDate(e.expense_date),
        e.status,
        csvTimestamp(e.created_at),
      ]),
    );
    sendCsv(res, 'expenses.csv', csv);
  } catch (err) {
    next(err);
  }
};

export const exportAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { expense_id, performed_by, action, date_from, date_to } = req.query;
    const parsedExpenseId = parsePositiveInteger(expense_id, 'expense_id');
    const parsedPerformedBy = parsePositiveInteger(performed_by, 'performed_by');
    const parsedAction = parseEnumQuery(action, 'action', AUDIT_ACTIONS) as AuditAction | undefined;
    const parsedDateFrom = parseDateQuery(date_from, 'date_from');
    const parsedDateTo = parseDateQuery(date_to, 'date_to');
    const parsedSort = parseStringQuery(req.query.sort, 'sort', { maxLength: 32 });
    const parsedOrder = parseStringQuery(req.query.order, 'order', { maxLength: 4 });

    const { data, capped } = await auditLogModel.findAllForExport({
      expense_id: parsedExpenseId,
      performed_by: parsedPerformedBy,
      action: parsedAction,
      date_from: parsedDateFrom,
      date_to: parsedDateTo,
      sort: parsedSort,
      order: parsedOrder,
    });

    if (capped) {
      logger.warn('Audit log export truncated at row cap', { cap: EXPORT_MAX_ROWS });
    }

    // Privileged read of the audit trail — record who exported what and how much.
    const filters: Record<string, unknown> = {};
    if (parsedExpenseId !== undefined) filters.expense_id = parsedExpenseId;
    if (parsedPerformedBy !== undefined) filters.performed_by = parsedPerformedBy;
    if (parsedAction !== undefined) filters.action = parsedAction;
    if (parsedDateFrom) filters.date_from = parsedDateFrom;
    if (parsedDateTo) filters.date_to = parsedDateTo;

    await securityEventModel.record({
      event_type: SecurityEventType.AUDIT_LOG_EXPORTED,
      outcome: SecurityOutcome.SUCCESS,
      user_id: req.user?.id ?? null,
      role: req.user?.role ?? null,
      ip_address: req.ip ?? null,
      request_id: req.id ?? null,
      detail: `Exported ${data.length} audit-log row(s)`,
      metadata: { filters, row_count: data.length, capped },
    });

    const csv = toCsv(
      ['ID', 'Expense ID', 'Action', 'Performed By', 'Old Status', 'New Status', 'Details', 'When'],
      data.map((a) => [
        a.id,
        a.expense_id,
        a.action,
        a.performer_name ?? '',
        a.old_status ?? '',
        a.new_status ?? '',
        a.details ? JSON.stringify(a.details) : '',
        csvTimestamp(a.created_at),
      ]),
    );
    sendCsv(res, 'audit-logs.csv', csv);
  } catch (err) {
    next(err);
  }
};

export const getAllUsers = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await userModel.findAll();
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
};
