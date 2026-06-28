import { Request, Response, NextFunction } from 'express';
import {
  getAuditLogs,
  getAllExpenses,
  exportAllExpenses,
  exportAuditLogs,
  getAllUsers,
} from '../../controllers/adminController';
import { auditLogModel } from '../../models/auditLog';
import { expenseModel } from '../../models/expense';
import { userModel } from '../../models/user';
import { securityEventModel } from '../../models/securityEvent';
import { Role, Status, Category, AuditAction, Expense, User, SecurityEventType, SecurityOutcome } from '../../types';
import { AppError } from '../../utils/errors';

// ── Mock models + logger ──────────────────────────────────────────
// The CSV util is intentionally NOT mocked so the export tests exercise the
// real, injection-safe serializer.

jest.mock('../../models/auditLog');
jest.mock('../../models/expense');
jest.mock('../../models/user');
jest.mock('../../models/securityEvent', () => ({
  securityEventModel: { record: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import logger from '../../config/logger';

const mockedAuditLogModel = auditLogModel as jest.Mocked<typeof auditLogModel>;
const mockedExpenseModel = expenseModel as jest.Mocked<typeof expenseModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedSecurityEvent = securityEventModel as jest.Mocked<typeof securityEventModel>;
const mockedLogger = logger as unknown as { warn: jest.Mock; info: jest.Mock; error: jest.Mock };

// ── Helpers ───────────────────────────────────────────────────────

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: { id: 3, role: Role.ADMIN, email: 'admin@test.com', display_name: 'Admin' },
  headers: {},
  params: {},
  query: {},
  ...overrides,
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res) as unknown as Response['setHeader'];
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockExpenseRow = (overrides: Partial<Expense> = {}): Expense => ({
  id: 10,
  submitted_by: 7,
  title: 'Flight to NYC',
  description: 'Business trip',
  amount: 450,
  currency: 'USD',
  category: Category.TRAVEL,
  expense_date: new Date('2026-03-01'),
  status: Status.PENDING,
  approved_by: null,
  rejection_reason: null,
  version: 1,
  created_at: new Date('2026-03-02T09:00:00.000Z'),
  updated_at: new Date('2026-03-02T09:00:00.000Z'),
  submitter_name: 'Employee Seven',
  submitter_email: 'emp7@test.com',
  ...overrides,
});

const sentBody = (res: Partial<Response>): string =>
  (res.send as jest.Mock).mock.calls[0][0] as string;

describe('adminController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    // resetAllMocks (not just clearAllMocks) so a mockRejectedValue queued by an
    // error-path test cannot leak into the next test.
    jest.resetAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // getAuditLogs
  // ────────────────────────────────────────────────────────────────

  describe('getAuditLogs', () => {
    it('forwards all parsed filters to the model and returns the paginated envelope', async () => {
      mockedAuditLogModel.findAll.mockResolvedValue({ data: [], total: 0 });

      const req = mockRequest({
        query: {
          expense_id: '5',
          performed_by: '7',
          action: AuditAction.APPROVED,
          date_from: '2026-01-01',
          date_to: '2026-02-01',
          sort: 'when',
          order: 'asc',
          page: '2',
          pageSize: '10',
        },
      });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      expect(mockedAuditLogModel.findAll).toHaveBeenCalledWith({
        expense_id: 5,
        performed_by: 7,
        action: AuditAction.APPROVED,
        date_from: '2026-01-01',
        date_to: '2026-02-01',
        sort: 'when',
        order: 'asc',
        page: 2,
        pageSize: 10,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [],
        pagination: { total: 0, page: 2, pageSize: 10 },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('applies default pagination and undefined filters when no query is given', async () => {
      mockedAuditLogModel.findAll.mockResolvedValue({ data: [], total: 0 });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      expect(mockedAuditLogModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          expense_id: undefined,
          performed_by: undefined,
          action: undefined,
          sort: undefined,
          order: undefined,
          page: 1,
          pageSize: 20,
        }),
      );
    });

    it('rejects an action outside the whitelist with 400 before hitting the model', async () => {
      const req = mockRequest({ query: { action: 'DROP TABLE' } });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(400);
      expect(mockedAuditLogModel.findAll).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric expense_id with 400 before hitting the model', async () => {
      const req = mockRequest({ query: { expense_id: 'abc' } });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedAuditLogModel.findAll).not.toHaveBeenCalled();
    });

    it('rejects an over-length sort key (>32 chars) with 400 — caps the value before SQL', async () => {
      const req = mockRequest({ query: { sort: 'x'.repeat(33) } });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedAuditLogModel.findAll).not.toHaveBeenCalled();
    });

    it('rejects a sort supplied more than once with 400', async () => {
      const req = mockRequest({ query: { sort: ['when', 'action'] as unknown as string } });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedAuditLogModel.findAll).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('audit query failed');
      mockedAuditLogModel.findAll.mockRejectedValue(dbError);

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await getAuditLogs(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getAllExpenses
  // ────────────────────────────────────────────────────────────────

  describe('getAllExpenses', () => {
    it('forwards parsed filters (incl. search/sort/order) to the model', async () => {
      const rows = [mockExpenseRow()];
      mockedExpenseModel.findAll.mockResolvedValue({ data: rows, total: 1 });

      const req = mockRequest({
        query: {
          status: Status.PENDING,
          category: Category.TRAVEL,
          search: 'flight',
          date_from: '2026-01-01',
          date_to: '2026-02-01',
          sort: 'amount',
          order: 'desc',
          page: '1',
          pageSize: '20',
        },
      });
      const res = mockResponse();

      await getAllExpenses(req as Request, res as Response, next);

      expect(mockedExpenseModel.findAll).toHaveBeenCalledWith({
        status: Status.PENDING,
        category: Category.TRAVEL,
        search: 'flight',
        date_from: '2026-01-01',
        date_to: '2026-02-01',
        sort: 'amount',
        order: 'desc',
        page: 1,
        pageSize: 20,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: rows,
        pagination: { total: 1, page: 1, pageSize: 20 },
      });
    });

    it('rejects a status outside the whitelist with 400 before hitting the model', async () => {
      const req = mockRequest({ query: { status: 'SETTLED' } });
      const res = mockResponse();

      await getAllExpenses(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedExpenseModel.findAll).not.toHaveBeenCalled();
    });

    it('rejects a category outside the whitelist with 400 before hitting the model', async () => {
      const req = mockRequest({ query: { category: 'BRIBES' } });
      const res = mockResponse();

      await getAllExpenses(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedExpenseModel.findAll).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('expense query failed');
      mockedExpenseModel.findAll.mockRejectedValue(dbError);

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await getAllExpenses(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // exportAllExpenses
  // ────────────────────────────────────────────────────────────────

  describe('exportAllExpenses', () => {
    it('streams a CSV download with the expected headers and column row', async () => {
      mockedExpenseModel.findAllForExport.mockResolvedValue({
        data: [mockExpenseRow()],
        capped: false,
      });

      const req = mockRequest({ query: { status: Status.PENDING } });
      const res = mockResponse();

      await exportAllExpenses(req as Request, res as Response, next);

      expect(mockedExpenseModel.findAllForExport).toHaveBeenCalledWith(
        expect.objectContaining({ status: Status.PENDING }),
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="expenses.csv"',
      );
      const body = sentBody(res);
      // Leading UTF-8 BOM so Excel reads UTF-8 correctly.
      expect(body.startsWith('﻿')).toBe(true);
      expect(body).toContain(
        'ID,Title,Submitter,Submitter Email,Category,Amount,Currency,Date,Status,Filed',
      );
      expect(body).toContain('Flight to NYC');
      // Exporting expenses is NOT a recorded security event — only audit-log
      // exports are.
      expect(mockedSecurityEvent.record).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('neutralizes CSV formula injection via the shared csv util', async () => {
      // A title beginning with "=" would be evaluated as a formula by Excel; the
      // injection-safe serializer must prefix it with an apostrophe.
      mockedExpenseModel.findAllForExport.mockResolvedValue({
        data: [mockExpenseRow({ title: '=cmd|/c calc' })],
        capped: false,
      });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAllExpenses(req as Request, res as Response, next);

      const body = sentBody(res);
      expect(body).toContain("'=cmd|/c calc");
      expect(body).not.toMatch(/,=cmd/);
    });

    it('logs a warning when the export is truncated at the row cap', async () => {
      mockedExpenseModel.findAllForExport.mockResolvedValue({
        data: [mockExpenseRow()],
        capped: true,
      });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAllExpenses(req as Request, res as Response, next);

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        'Admin expense export truncated at row cap',
        expect.objectContaining({ cap: expect.any(Number) }),
      );
    });

    it('renders empty cells (not "null") for missing submitter name/email', async () => {
      mockedExpenseModel.findAllForExport.mockResolvedValue({
        data: [mockExpenseRow({ submitter_name: undefined, submitter_email: undefined })],
        capped: false,
      });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAllExpenses(req as Request, res as Response, next);

      const body = sentBody(res);
      expect(body).not.toContain('null');
      expect(body).not.toContain('undefined');
    });

    it('rejects a status outside the whitelist with 400 before hitting the model', async () => {
      const req = mockRequest({ query: { status: 'SETTLED' } });
      const res = mockResponse();

      await exportAllExpenses(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedExpenseModel.findAllForExport).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('export query failed');
      mockedExpenseModel.findAllForExport.mockRejectedValue(dbError);

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAllExpenses(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // exportAuditLogs
  // ────────────────────────────────────────────────────────────────

  describe('exportAuditLogs', () => {
    const mockAuditExportRow = () => ({
      id: 1,
      expense_id: 10,
      action: AuditAction.APPROVED,
      performed_by: 7,
      performer_name: 'Manager Mike',
      old_status: Status.PENDING,
      new_status: Status.APPROVED,
      details: { note: 'looks good' },
      ip_address: '127.0.0.1',
      created_at: new Date('2026-03-02T09:00:00.000Z'),
    });

    it('streams a CSV download with headers, JSON-encoded details and the performer name', async () => {
      mockedAuditLogModel.findAllForExport.mockResolvedValue({
        data: [mockAuditExportRow()],
        capped: false,
      });

      const req = mockRequest({ query: { action: AuditAction.APPROVED } });
      const res = mockResponse();

      await exportAuditLogs(req as Request, res as Response, next);

      expect(mockedAuditLogModel.findAllForExport).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.APPROVED }),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="audit-logs.csv"',
      );
      const body = sentBody(res);
      expect(body.startsWith('﻿')).toBe(true);
      expect(body).toContain('ID,Expense ID,Action,Performed By,Old Status,New Status,Details,When');
      expect(body).toContain('Manager Mike');
      // details serialized as JSON (quoted because it contains a comma/quote).
      expect(body).toContain('looks good');

      // The privileged export is recorded against the requesting admin.
      expect(mockedSecurityEvent.record).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: SecurityEventType.AUDIT_LOG_EXPORTED,
          outcome: SecurityOutcome.SUCCESS,
          user_id: 3,
          role: Role.ADMIN,
          metadata: expect.objectContaining({ row_count: 1, filters: { action: AuditAction.APPROVED } }),
        }),
      );
    });

    it('neutralizes CSV formula injection in the performer name', async () => {
      mockedAuditLogModel.findAllForExport.mockResolvedValue({
        data: [{ ...mockAuditExportRow(), performer_name: '=HYPERLINK("http://evil")' }],
        capped: false,
      });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAuditLogs(req as Request, res as Response, next);

      const body = sentBody(res);
      expect(body).toContain("'=HYPERLINK");
    });

    it('logs a warning when the audit export is truncated at the row cap', async () => {
      mockedAuditLogModel.findAllForExport.mockResolvedValue({
        data: [mockAuditExportRow()],
        capped: true,
      });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAuditLogs(req as Request, res as Response, next);

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        'Audit log export truncated at row cap',
        expect.objectContaining({ cap: expect.any(Number) }),
      );
    });

    it('renders empty cells for null performer/status/details fields', async () => {
      mockedAuditLogModel.findAllForExport.mockResolvedValue({
        data: [
          {
            ...mockAuditExportRow(),
            performer_name: null,
            old_status: null,
            new_status: null,
            details: null,
          },
        ],
        capped: false,
      });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAuditLogs(req as Request, res as Response, next);

      const body = sentBody(res);
      expect(body).not.toContain('null');
      expect(body).not.toContain('undefined');
    });

    it('rejects an action outside the whitelist with 400 before hitting the model', async () => {
      const req = mockRequest({ query: { action: 'PURGE' } });
      const res = mockResponse();

      await exportAuditLogs(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedAuditLogModel.findAllForExport).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('audit export query failed');
      mockedAuditLogModel.findAllForExport.mockRejectedValue(dbError);

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportAuditLogs(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getAllUsers
  // ────────────────────────────────────────────────────────────────

  describe('getAllUsers', () => {
    it('returns every user in the standard envelope', async () => {
      const users = [
        {
          id: 1,
          entra_id: 'entra-1',
          email: 'a@test.com',
          display_name: 'Alice',
          role: Role.ADMIN,
          manager_id: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ] as User[];
      mockedUserModel.findAll.mockResolvedValue(users);

      const req = mockRequest();
      const res = mockResponse();

      await getAllUsers(req as Request, res as Response, next);

      // Real admin → org-wide list (no demo scope passed).
      expect(mockedUserModel.findAll).toHaveBeenCalledWith(undefined);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: users });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('user list query failed');
      mockedUserModel.findAll.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await getAllUsers(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Demo-session scoping — read views are scoped to the caller's own
  // demo workspace; a demo session with no workspace id is refused (403)
  // rather than ever running an unscoped, org-wide query.
  // ────────────────────────────────────────────────────────────────

  describe('demo session scoping', () => {
    const demoReq = (overrides: Partial<Request> = {}): Partial<Request> =>
      mockRequest({
        user: {
          id: 9,
          role: Role.ADMIN,
          email: 'demo.admin@demo.local',
          display_name: 'Demo Admin',
          demoMode: true,
          demoSessionId: 'sess-abc',
        },
        ...overrides,
      });

    it('getAllUsers forwards the demo workspace id to the model', async () => {
      mockedUserModel.findAll.mockResolvedValue([]);
      await getAllUsers(demoReq() as Request, mockResponse() as Response, next);
      expect(mockedUserModel.findAll).toHaveBeenCalledWith('sess-abc');
      expect(next).not.toHaveBeenCalled();
    });

    it('getAllExpenses forwards the demo workspace id to the model', async () => {
      mockedExpenseModel.findAll.mockResolvedValue({ data: [], total: 0 });
      await getAllExpenses(demoReq({ query: {} }) as Request, mockResponse() as Response, next);
      expect(mockedExpenseModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ demoSessionId: 'sess-abc' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('getAuditLogs forwards the demo workspace id to the model', async () => {
      mockedAuditLogModel.findAll.mockResolvedValue({ data: [], total: 0 });
      await getAuditLogs(demoReq({ query: {} }) as Request, mockResponse() as Response, next);
      expect(mockedAuditLogModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ demoSessionId: 'sess-abc' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses a demo session with no workspace id (403) and never queries', async () => {
      const req = mockRequest({
        user: { id: 9, role: Role.ADMIN, email: 'demo.admin@demo.local', display_name: 'Demo Admin', demoMode: true },
      });
      await getAllUsers(req as Request, mockResponse() as Response, next);
      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
      expect(mockedUserModel.findAll).not.toHaveBeenCalled();
    });
  });
});
