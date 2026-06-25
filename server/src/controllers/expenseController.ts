import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { expenseModel } from '../models/expense';
import { auditLogModel } from '../models/auditLog';
import { receiptModel } from '../models/receipt';
import { Status, AuditAction, Role } from '../types';
import { notFound, forbidden, badRequest, conflict } from '../utils/errors';
import { expenseSubmissionsTotal } from '../services/metricsService';
import { verifyManagerRelationship } from '../services/managerAuthorization';
import { notificationService } from '../services/notificationService';
import { parsePagination } from '../utils/pagination';
import { STATUSES, CATEGORIES } from '../utils/constants';
import {
  parseEnumQuery,
  parsePositiveId,
  parseStringQuery,
  parseDateQuery,
} from '../utils/requestParsing';
import {
  encodeReceiptDownloadName,
  isAllowedReceiptMimeType,
  resolveReceiptPath,
  safeUnlinkReceipt,
  sanitizeReceiptDownloadName,
} from '../utils/receiptFiles';
import logger from '../config/logger';
import { toCsv, csvDate, csvTimestamp } from '../utils/csv';
import { EXPORT_MAX_ROWS } from '../utils/constants';
import { Receipt } from '../types';

const UTF8_BOM = '﻿';

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Prepend a UTF-8 BOM so Excel detects the encoding correctly.
  res.send(UTF8_BOM + csv);
}

function serializeReceipt(receipt: Receipt) {
  return {
    id: receipt.id,
    expense_id: receipt.expense_id,
    file_name: receipt.file_name,
    mime_type: receipt.mime_type,
    file_size: receipt.file_size,
    uploaded_at: receipt.uploaded_at,
  };
}

export const createExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let receiptPersisted = false;

  try {
    const userId = req.user!.id;
    const { title, description, amount, currency, category, expense_date } = req.body;

    // Magic-byte verification already runs in validateReceiptUpload middleware,
    // which deletes the file on failure. No need to re-check here.

    const receiptInput = req.file
      ? {
          file_name: sanitizeReceiptDownloadName(req.file.originalname).slice(0, 255),
          file_path: req.file.path,
          mime_type: req.file.mimetype,
          file_size: req.file.size,
        }
      : null;

    // Expense row + receipt + SUBMITTED audit entry commit atomically.
    const { expense, receipt } = await expenseModel.createSubmission({
      expense: {
        submitted_by: userId,
        title,
        description: description ?? null,
        amount,
        currency,
        category,
        expense_date,
      },
      receipt: receiptInput,
      ipAddress: req.ip || null,
    });
    // The receipt row is committed; on a later failure the file is already owned
    // by a persisted expense, so it must NOT be cleaned up.
    receiptPersisted = req.file != null;

    expenseSubmissionsTotal.inc();

    // Best-effort in-app notification to the submitter's manager.
    await notificationService.expenseForApproval({
      submitterId: userId,
      actor: req.user!,
      expense,
      resubmit: false,
    });

    res.status(201).json({ success: true, data: { ...expense, receipts: receipt ? [serializeReceipt(receipt)] : [] } });
  } catch (err) {
    if (req.file && !receiptPersisted) {
      safeUnlinkReceipt(req.file.path).catch((unlinkErr: unknown) => {
        logger.warn('Failed to clean up receipt after create failure', {
          error: unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr),
        });
      });
    }
    next(err);
  }
};

export const getExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;
    const status = parseEnumQuery(req.query.status, 'status', STATUSES) as Status | undefined;
    const category = parseEnumQuery(req.query.category, 'category', CATEGORIES);
    const search = parseStringQuery(req.query.search, 'search', { maxLength: 100 });
    const dateFrom = parseDateQuery(req.query.date_from, 'date_from');
    const dateTo = parseDateQuery(req.query.date_to, 'date_to');
    const sort = parseStringQuery(req.query.sort, 'sort', { maxLength: 32 });
    const order = parseStringQuery(req.query.order, 'order', { maxLength: 4 });
    const { page, pageSize } = parsePagination(req.query);

    const result = await expenseModel.findByUserId(userId, {
      status,
      category,
      search,
      date_from: dateFrom,
      date_to: dateTo,
      sort,
      order,
      page,
      pageSize,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page,
        pageSize,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const exportMyExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;
    const status = parseEnumQuery(req.query.status, 'status', STATUSES) as Status | undefined;
    const category = parseEnumQuery(req.query.category, 'category', CATEGORIES);
    const search = parseStringQuery(req.query.search, 'search', { maxLength: 100 });
    const dateFrom = parseDateQuery(req.query.date_from, 'date_from');
    const dateTo = parseDateQuery(req.query.date_to, 'date_to');
    const sort = parseStringQuery(req.query.sort, 'sort', { maxLength: 32 });
    const order = parseStringQuery(req.query.order, 'order', { maxLength: 4 });

    const { data, capped } = await expenseModel.findByUserIdForExport(userId, {
      status,
      category,
      search,
      date_from: dateFrom,
      date_to: dateTo,
      sort,
      order,
    });

    if (capped) {
      logger.warn('Expense export truncated at row cap', { userId, cap: EXPORT_MAX_ROWS });
    }

    const csv = toCsv(
      ['ID', 'Title', 'Category', 'Amount', 'Currency', 'Date', 'Status', 'Filed'],
      data.map((e) => [
        e.id,
        e.title,
        e.category,
        e.amount,
        e.currency,
        csvDate(e.expense_date),
        e.status,
        csvTimestamp(e.created_at),
      ]),
    );
    sendCsv(res, 'my-expenses.csv', csv);
  } catch (err) {
    next(err);
  }
};

export const getExpenseById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    // Own expenses are always viewable. Otherwise: admins see anything,
    // managers only see direct reports (via Graph), employees are denied.
    if (expense.submitted_by !== req.user!.id) {
      if (req.user!.role === Role.EMPLOYEE) {
        next(forbidden());
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
    }

    const receipts = await receiptModel.findByExpenseId(expenseId);
    res.json({ success: true, data: { ...expense, receipts: receipts.map(serializeReceipt) } });
  } catch (err) {
    next(err);
  }
};

export const updateExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    if (expense.submitted_by !== req.user!.id) {
      next(forbidden('You can only update your own expenses'));
      return;
    }

    if (expense.status !== Status.PENDING) {
      next(conflict('Only pending expenses can be updated'));
      return;
    }

    const { expense: updated, appliedFields } = await expenseModel.update(expenseId, req.body, expense.version);
    if (!updated) {
      next(conflict('Expense was modified by another request. Please refresh and try again.'));
      return;
    }

    // Skip audit if the update was a no-op (empty body or all undefined fields)
    if (appliedFields.length > 0) {
      await auditLogModel.create({
        expense_id: expenseId,
        action: AuditAction.UPDATED,
        performed_by: req.user!.id,
        old_status: Status.PENDING,
        new_status: Status.PENDING,
        details: { updated_fields: appliedFields },
        ip_address: req.ip || null,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

export const resubmitExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    if (expense.submitted_by !== req.user!.id) {
      next(forbidden('You can only resubmit your own expenses'));
      return;
    }

    if (expense.status !== Status.REJECTED) {
      next(conflict('Only rejected expenses can be resubmitted'));
      return;
    }

    const { result, expense: updated, appliedFields } = await expenseModel.resubmit(
      expenseId,
      req.body,
      expense.version,
    );

    if (result === 'NOT_FOUND') {
      next(notFound('Expense'));
      return;
    }
    if (result === 'NOT_REJECTED') {
      next(conflict('Only rejected expenses can be resubmitted'));
      return;
    }
    if (result !== 'SUCCESS' || !updated) {
      next(conflict('Expense was modified by another request. Please refresh and try again.'));
      return;
    }

    await auditLogModel.create({
      expense_id: expenseId,
      action: AuditAction.RESUBMITTED,
      performed_by: req.user!.id,
      old_status: Status.REJECTED,
      new_status: Status.PENDING,
      details: appliedFields.length > 0 ? { updated_fields: appliedFields } : null,
      ip_address: req.ip || null,
    });

    expenseSubmissionsTotal.inc();

    await notificationService.expenseForApproval({
      submitterId: req.user!.id,
      actor: req.user!,
      expense: updated,
      resubmit: true,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

export const deleteExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    if (expense.submitted_by !== req.user!.id) {
      next(forbidden('You can only delete your own expenses'));
      return;
    }

    if (expense.status !== Status.PENDING) {
      next(conflict('Only pending expenses can be deleted'));
      return;
    }

    // Fetch receipts before deletion so we can clean up files
    const receipts = await receiptModel.findByExpenseId(expenseId);

    const result = await expenseModel.delete(expenseId, req.user!.id, expense.version, req.ip || null);
    if (result === 'NOT_FOUND') {
      next(notFound('Expense'));
      return;
    }
    if (result === 'CONFLICT') {
      next(conflict('Expense was modified by another request. Please refresh and try again.'));
      return;
    }

    // Clean up receipt files from disk (best-effort — log but don't fail the request)
    for (const receipt of receipts) {
      safeUnlinkReceipt(receipt.file_path).catch((err: unknown) => {
        logger.warn('Failed to unlink receipt file', { path: receipt.file_path, error: err instanceof Error ? err.message : String(err) });
      });
    }

    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    next(err);
  }
};

export const downloadReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');
    const receiptId = parsePositiveId(req.params.receiptId, 'receipt ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    // Same gate as getExpenseById: own → allow; admin → allow; manager → must
    // manage submitter (via Graph); employee → deny.
    if (expense.submitted_by !== req.user!.id) {
      if (req.user!.role === Role.EMPLOYEE) {
        next(forbidden());
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
    }

    const receipt = await receiptModel.findById(receiptId);
    if (!receipt || receipt.expense_id !== expenseId) {
      next(notFound('Receipt'));
      return;
    }

    if (!isAllowedReceiptMimeType(receipt.mime_type)) {
      next(badRequest('Invalid receipt file type'));
      return;
    }

    const filePath = resolveReceiptPath(receipt.file_path);
    if (!filePath) {
      next(notFound('Receipt file'));
      return;
    }

    // Verify the file exists
    try {
      await fs.access(filePath);
    } catch {
      next(notFound('Receipt file'));
      return;
    }

    // Sanitize filename before setting Content-Disposition — file_name ultimately
    // comes from multer's file.originalname (attacker-controlled). Raw quotes or
    // CRLF would let an attacker inject response headers.
    // Why "attachment": serving uploaded PDFs/images inline lets a malicious
    // upload run JS in some PDF viewers or fingerprint the viewer. Force download.
    const asciiFallback = sanitizeReceiptDownloadName(receipt.file_name);
    const utf8Encoded = encodeReceiptDownloadName(sanitizeReceiptDownloadName(receipt.file_name));
    res.setHeader('Content-Type', receipt.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`,
    );
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
};
