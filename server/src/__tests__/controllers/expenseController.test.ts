import { Request, Response, NextFunction } from 'express';
import { expenseModel } from '../../models/expense';
import { auditLogModel } from '../../models/auditLog';
import { createExpense, getExpenses, getExpenseById, updateExpense, deleteExpense, resubmitExpense, exportMyExpenses } from '../../controllers/expenseController';
import { Status, AuditAction, Category, Role, Expense, AuditLog, Receipt } from '../../types';
import { AppError } from '../../utils/errors';

// ── Mock models ────────────────────────────────────────────────

jest.mock('../../models/expense');
jest.mock('../../models/auditLog');
jest.mock('../../models/receipt');
jest.mock('../../models/user');
jest.mock('../../services/graphApi');
jest.mock('../../services/notificationService');
// Partial-mock: keep the real path/sanitizer helpers but stub safeUnlinkReceipt
// so receipt-file cleanup can be asserted without touching the disk.
jest.mock('../../utils/receiptFiles', () => {
  const actual = jest.requireActual('../../utils/receiptFiles');
  return { __esModule: true, ...actual, safeUnlinkReceipt: jest.fn().mockResolvedValue(undefined) };
});

import { receiptModel } from '../../models/receipt';
import { userModel } from '../../models/user';
import { graphApiService } from '../../services/graphApi';
import { notificationService } from '../../services/notificationService';
import { safeUnlinkReceipt } from '../../utils/receiptFiles';

const mockedExpenseModel = expenseModel as jest.Mocked<typeof expenseModel>;
const mockedAuditLogModel = auditLogModel as jest.Mocked<typeof auditLogModel>;
const mockedReceiptModel = receiptModel as jest.Mocked<typeof receiptModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;
const mockedNotificationService = notificationService as jest.Mocked<typeof notificationService>;
const mockedSafeUnlinkReceipt = safeUnlinkReceipt as jest.MockedFunction<typeof safeUnlinkReceipt>;

// ── Helpers ────────────────────────────────────────────────────

const mockUser = (overrides: Partial<Request['user']> = {}): Request['user'] => ({
  id: 1,
  role: Role.EMPLOYEE,
  assignedRoles: [Role.EMPLOYEE],
  email: 'emp@test.com',
  display_name: 'Employee',
  ...overrides,
});

const mockExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 10,
  submitted_by: 1,
  title: 'Flight to NYC',
  description: 'Business trip',
  amount: 450.00,
  currency: 'USD',
  category: Category.TRAVEL,
  expense_date: new Date('2026-03-01'),
  status: Status.PENDING,
  approved_by: null,
  rejection_reason: null,
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const mockAuditLog = (overrides: Partial<AuditLog> = {}): AuditLog => ({
  id: 1,
  expense_id: 10,
  action: AuditAction.SUBMITTED,
  performed_by: 1,
  old_status: null,
  new_status: Status.PENDING,
  details: null,
  ip_address: null,
  created_at: new Date(),
  ...overrides,
});

const mockReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: 5,
  expense_id: 10,
  file_name: 'invoice.pdf',
  file_path: '/srv/uploads/stored-receipt.pdf',
  mime_type: 'application/pdf',
  file_size: 2048,
  uploaded_at: new Date(),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: mockUser(),
  body: {},
  params: {},
  query: {},
  headers: {},
  ip: '127.0.0.1',
  ...overrides,
} as Partial<Request>);

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res as Response);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

// ── Tests ──────────────────────────────────────────────────────

describe('expenseController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────
  // createExpense
  // ────────────────────────────────────────────────────────────

  describe('createExpense', () => {
    const validBody = {
      title: 'Flight to NYC',
      description: 'Business trip',
      amount: 450.00,
      currency: 'USD',
      category: Category.TRAVEL,
      expense_date: '2026-03-01',
    };

    it('should create an expense and return 201', async () => {
      const expense = mockExpense();
      mockedExpenseModel.createSubmission.mockResolvedValue({ expense, receipt: null });

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.createSubmission).toHaveBeenCalledWith({
        expense: {
          submitted_by: 1,
          title: 'Flight to NYC',
          description: 'Business trip',
          amount: 450.00,
          currency: 'USD',
          category: Category.TRAVEL,
          expense_date: '2026-03-01',
        },
        receipt: null,
        ipAddress: '127.0.0.1',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...expense, receipts: [] } });
    });

    it('should submit the expense atomically with audit context (ip address)', async () => {
      const expense = mockExpense();
      mockedExpenseModel.createSubmission.mockResolvedValue({ expense, receipt: null });

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      // The SUBMITTED audit row is written inside createSubmission's transaction;
      // the controller's job is to pass the requester IP through to it.
      expect(mockedExpenseModel.createSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: '127.0.0.1' }),
      );
      expect(mockedAuditLogModel.create).not.toHaveBeenCalled();
    });

    it('should set description to null when not provided', async () => {
      const bodyWithoutDesc = { ...validBody, description: undefined };
      const expense = mockExpense({ description: null });
      mockedExpenseModel.createSubmission.mockResolvedValue({ expense, receipt: null });

      const req = mockRequest({ body: bodyWithoutDesc });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.createSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ expense: expect.objectContaining({ description: null }) }),
      );
    });

    it('should call next(err) when model throws', async () => {
      const dbError = new Error('DB connection failed');
      mockedExpenseModel.createSubmission.mockRejectedValue(dbError);

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should notify the submitter\'s manager for approval (resubmit:false)', async () => {
      const expense = mockExpense();
      mockedExpenseModel.createSubmission.mockResolvedValue({ expense, receipt: null });

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      // The notification side-effect is now mocked (not the real service running
      // against mocked models) and its exact args are asserted.
      expect(mockedNotificationService.expenseForApproval).toHaveBeenCalledWith({
        submitterId: 1,
        actor: req.user,
        expense,
        resubmit: false,
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // getExpenses
  // ────────────────────────────────────────────────────────────

  describe('getExpenses', () => {
    it('should return expenses with pagination metadata', async () => {
      const expenses = [mockExpense(), mockExpense({ id: 11 })];
      mockedExpenseModel.findByUserId.mockResolvedValue({ data: expenses, total: 2 });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await getExpenses(req as Request, res as Response, next);

      expect(mockedExpenseModel.findByUserId).toHaveBeenCalledWith(1, {
        status: undefined,
        page: 1,
        pageSize: 20,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expenses,
        pagination: { total: 2, page: 1, pageSize: 20 },
      });
    });

    it('should pass status and pagination query params to the model', async () => {
      mockedExpenseModel.findByUserId.mockResolvedValue({ data: [], total: 0 });

      const req = mockRequest({
        query: { status: Status.PENDING, page: '2', pageSize: '10' },
      });
      const res = mockResponse();

      await getExpenses(req as Request, res as Response, next);

      expect(mockedExpenseModel.findByUserId).toHaveBeenCalledWith(1, {
        status: Status.PENDING,
        page: 2,
        pageSize: 10,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          pagination: { total: 0, page: 2, pageSize: 10 },
        }),
      );
    });

    it('should forward concrete category/search/date/sort/order filters to the model', async () => {
      mockedExpenseModel.findByUserId.mockResolvedValue({ data: [], total: 0 });

      const req = mockRequest({
        query: {
          category: Category.TRAVEL,
          search: 'flight',
          date_from: '2026-01-01',
          date_to: '2026-02-01',
          sort: 'amount',
          order: 'desc',
        },
      });
      const res = mockResponse();

      await getExpenses(req as Request, res as Response, next);

      // Concrete (non-undefined) values prove each filter survives the passthrough;
      // toHaveBeenCalledWith would silently ignore a dropped filter left undefined.
      expect(mockedExpenseModel.findByUserId).toHaveBeenCalledWith(1, {
        status: undefined,
        category: Category.TRAVEL,
        search: 'flight',
        date_from: '2026-01-01',
        date_to: '2026-02-01',
        sort: 'amount',
        order: 'desc',
        page: 1,
        pageSize: 20,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next(err) when model throws', async () => {
      const dbError = new Error('DB error');
      mockedExpenseModel.findByUserId.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await getExpenses(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────
  // getExpenseById
  // ────────────────────────────────────────────────────────────

  describe('getExpenseById', () => {
    it('should return the expense when it belongs to the requesting user', async () => {
      const expense = mockExpense({ submitted_by: 1 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedReceiptModel.findByExpenseId.mockResolvedValue([]);

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      expect(mockedExpenseModel.findById).toHaveBeenCalledWith(10);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...expense, receipts: [] } });
    });

    it('should return 400 for a non-numeric ID', async () => {
      const req = mockRequest({ params: { id: 'abc' } });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid expense ID');
    });

    it('should return 404 when expense does not exist', async () => {
      mockedExpenseModel.findById.mockResolvedValue(null);

      const req = mockRequest({ params: { id: '999' } });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Expense not found');
    });

    it('should return 403 when an EMPLOYEE tries to view another user\'s expense', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({
        params: { id: '10' },
        user: mockUser({ id: 1, role: Role.EMPLOYEE }),
      });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
    });

    it('should allow a MANAGER to view an expense submitted by their direct report', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedReceiptModel.findByExpenseId.mockResolvedValue([]);
      mockedUserModel.findById.mockResolvedValue({
        id: 99,
        entra_id: 'entra-employee-99',
        email: 'e99@test.com',
        display_name: 'Employee 99',
        role: Role.EMPLOYEE,
        manager_id: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockedGraphApiService.isManagerOf.mockResolvedValue(true);

      const req = mockRequest({
        params: { id: '10' },
        headers: { authorization: 'Bearer token-123' },
        user: mockUser({ id: 1, role: Role.MANAGER }),
      });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledWith(1, 'entra-employee-99', 'token-123', {
        allowCachedFallback: false,
        forceRefresh: true,
      });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...expense, receipts: [] } });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 403 when a MANAGER views an expense outside their reporting chain', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedUserModel.findById.mockResolvedValue({
        id: 99,
        entra_id: 'entra-employee-99',
        email: 'e99@test.com',
        display_name: 'Employee 99',
        role: Role.EMPLOYEE,
        manager_id: 2,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      mockedGraphApiService.isManagerOf.mockResolvedValue(false);

      const req = mockRequest({
        params: { id: '10' },
        headers: { authorization: 'Bearer token-123' },
        user: mockUser({ id: 1, role: Role.MANAGER }),
      });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should allow an ADMIN to view another user\'s expense without a chain check', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedReceiptModel.findByExpenseId.mockResolvedValue([]);

      const req = mockRequest({
        params: { id: '10' },
        user: mockUser({ id: 1, role: Role.ADMIN }),
      });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...expense, receipts: [] } });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next(err) when model throws', async () => {
      const dbError = new Error('DB error');
      mockedExpenseModel.findById.mockRejectedValue(dbError);

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await getExpenseById(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────
  // updateExpense
  // ────────────────────────────────────────────────────────────

  describe('updateExpense', () => {
    const updateBody = { title: 'Updated title', amount: 500 };

    it('should update a pending expense and return the updated data', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING, version: 1 });
      const updatedExpense = mockExpense({ ...expense, title: 'Updated title', amount: 500, version: 2 });

      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.update.mockResolvedValue({ expense: updatedExpense, appliedFields: ['title', 'amount'] });
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog({ action: AuditAction.UPDATED }));

      const req = mockRequest({ params: { id: '10' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.update).toHaveBeenCalledWith(10, updateBody, 1);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: updatedExpense });
    });

    it('should create an UPDATED audit log with updated fields', async () => {
      const expense = mockExpense({ submitted_by: 1 });
      const updatedExpense = mockExpense({ version: 2 });

      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.update.mockResolvedValue({ expense: updatedExpense, appliedFields: ['title', 'amount'] });
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog());

      const req = mockRequest({ params: { id: '10' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      expect(mockedAuditLogModel.create).toHaveBeenCalledWith({
        expense_id: 10,
        action: AuditAction.UPDATED,
        performed_by: 1,
        old_status: Status.PENDING,
        new_status: Status.PENDING,
        details: { updated_fields: ['title', 'amount'] },
        ip_address: '127.0.0.1',
      });
    });

    it('should skip the audit row when the update applied no fields (no-op)', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING, version: 1 });
      const updated = mockExpense({ ...expense, version: 2 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.update.mockResolvedValue({ expense: updated, appliedFields: [] });

      const req = mockRequest({ params: { id: '10' }, body: {} });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
      expect(mockedAuditLogModel.create).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 for a non-numeric ID', async () => {
      const req = mockRequest({ params: { id: 'xyz' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid expense ID');
    });

    it('should return 404 when expense does not exist', async () => {
      mockedExpenseModel.findById.mockResolvedValue(null);

      const req = mockRequest({ params: { id: '999' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Expense not found');
    });

    it('should return 403 when user tries to update another user\'s expense', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({ params: { id: '10' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('You can only update your own expenses');
    });

    it('should return 409 when expense is not PENDING', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.APPROVED });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({ params: { id: '10' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Only pending expenses can be updated');
    });

    it('should return 409 on optimistic concurrency conflict (version mismatch)', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING, version: 1 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.update.mockResolvedValue({ expense: null, appliedFields: [] }); // version mismatch

      const req = mockRequest({ params: { id: '10' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toContain('modified by another request');
    });

    it('should call next(err) when model throws', async () => {
      const dbError = new Error('DB error');
      mockedExpenseModel.findById.mockRejectedValue(dbError);

      const req = mockRequest({ params: { id: '10' }, body: updateBody });
      const res = mockResponse();

      await updateExpense(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────
  // deleteExpense
  // ────────────────────────────────────────────────────────────

  describe('deleteExpense', () => {
    it('should delete a pending expense and return success', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING, version: 1 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.delete.mockResolvedValue('SUCCESS');

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.delete).toHaveBeenCalledWith(10, 1, expense.version, '127.0.0.1');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Expense deleted' });
    });

    it('should unlink every stored receipt file after a successful delete', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING, version: 4 });
      const receipts = [
        mockReceipt({ id: 1, file_path: '/srv/uploads/r1.pdf' }),
        mockReceipt({ id: 2, file_path: '/srv/uploads/r2.pdf' }),
      ];
      mockedExpenseModel.findById.mockResolvedValue(expense);
      // Explicit setup — the happy-path test above only works off a leaked
      // findByExpenseId implementation (clearAllMocks keeps implementations); this
      // pins the two-receipt cleanup case so it never depends on test ordering.
      mockedReceiptModel.findByExpenseId.mockResolvedValue(receipts);
      mockedExpenseModel.delete.mockResolvedValue('SUCCESS');

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.delete).toHaveBeenCalledWith(10, 1, 4, '127.0.0.1');
      expect(mockedSafeUnlinkReceipt).toHaveBeenCalledTimes(2);
      expect(mockedSafeUnlinkReceipt).toHaveBeenCalledWith('/srv/uploads/r1.pdf');
      expect(mockedSafeUnlinkReceipt).toHaveBeenCalledWith('/srv/uploads/r2.pdf');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Expense deleted' });
    });

    it('should return 404 when the row vanished between read and delete (NOT_FOUND)', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING, version: 1 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedReceiptModel.findByExpenseId.mockResolvedValue([]);
      mockedExpenseModel.delete.mockResolvedValue('NOT_FOUND');

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Expense not found');
      expect(mockedSafeUnlinkReceipt).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should return 400 for a non-numeric ID', async () => {
      const req = mockRequest({ params: { id: 'abc' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid expense ID');
    });

    it('should return 404 when expense does not exist', async () => {
      mockedExpenseModel.findById.mockResolvedValue(null);

      const req = mockRequest({ params: { id: '999' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Expense not found');
    });

    it('should return 403 when user tries to delete another user\'s expense', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('You can only delete your own expenses');
    });

    it('should return 409 when expense is not PENDING', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.APPROVED });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Only pending expenses can be deleted');
    });

    it('should return 409 when delete fails optimistic-version check', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.delete.mockResolvedValue('CONFLICT');

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toContain('modified by another request');
    });

    it('should call next(err) when model throws', async () => {
      const dbError = new Error('DB error');
      mockedExpenseModel.findById.mockRejectedValue(dbError);

      const req = mockRequest({ params: { id: '10' } });
      const res = mockResponse();

      await deleteExpense(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────
  // resubmitExpense  (REJECTED → PENDING)
  // ────────────────────────────────────────────────────────────

  describe('resubmitExpense', () => {
    const resubmitBody = { title: 'Corrected title' };

    it('should resubmit a REJECTED expense: forward (id, body, version) and return the updated expense', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      const updatedExpense = mockExpense({ id: 10, status: Status.PENDING, version: 4, title: 'Corrected title' });

      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({
        result: 'SUCCESS',
        expense: updatedExpense,
        appliedFields: ['title'],
      });
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog({ action: AuditAction.RESUBMITTED }));

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      // Optimistic-lock version flows from the freshly-read row into resubmit().
      expect(mockedExpenseModel.resubmit).toHaveBeenCalledWith(10, resubmitBody, 3);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: updatedExpense });
      expect(next).not.toHaveBeenCalled();
    });

    it('should notify the manager with resubmit:true after a successful resubmit', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      const updatedExpense = mockExpense({ id: 10, status: Status.PENDING, version: 4, title: 'Corrected title' });

      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({
        result: 'SUCCESS',
        expense: updatedExpense,
        appliedFields: ['title'],
      });
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog({ action: AuditAction.RESUBMITTED }));

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      // The manager notification carries the UPDATED expense and resubmit:true.
      expect(mockedNotificationService.expenseForApproval).toHaveBeenCalledWith({
        submitterId: 1,
        actor: req.user,
        expense: updatedExpense,
        resubmit: true,
      });
    });

    it('should record a RESUBMITTED audit entry with the REJECTED→PENDING transition', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      const updatedExpense = mockExpense({ status: Status.PENDING, version: 4 });

      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({
        result: 'SUCCESS',
        expense: updatedExpense,
        appliedFields: ['title', 'amount'],
      });
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog({ action: AuditAction.RESUBMITTED }));

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      expect(mockedAuditLogModel.create).toHaveBeenCalledWith({
        expense_id: 10,
        action: AuditAction.RESUBMITTED,
        performed_by: 1,
        old_status: Status.REJECTED,
        new_status: Status.PENDING,
        details: { updated_fields: ['title', 'amount'] },
        ip_address: '127.0.0.1',
      });
    });

    it('should record null audit details when no fields were changed on resubmit', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      const updatedExpense = mockExpense({ status: Status.PENDING, version: 4 });

      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({
        result: 'SUCCESS',
        expense: updatedExpense,
        appliedFields: [],
      });
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog({ action: AuditAction.RESUBMITTED }));

      const req = mockRequest({ params: { id: '10' }, body: {} });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      expect(mockedAuditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.RESUBMITTED, details: null }),
      );
    });

    it('should return 400 for a non-numeric ID', async () => {
      const req = mockRequest({ params: { id: 'abc' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid expense ID');
      expect(mockedExpenseModel.resubmit).not.toHaveBeenCalled();
    });

    it('should return 404 when the expense does not exist', async () => {
      mockedExpenseModel.findById.mockResolvedValue(null);

      const req = mockRequest({ params: { id: '999' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Expense not found');
      expect(mockedExpenseModel.resubmit).not.toHaveBeenCalled();
    });

    it('should return 403 when a user tries to resubmit another user\'s expense', async () => {
      const expense = mockExpense({ submitted_by: 99, status: Status.REJECTED });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('You can only resubmit your own expenses');
      expect(mockedExpenseModel.resubmit).not.toHaveBeenCalled();
    });

    it('should return 409 when the expense is not REJECTED', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.PENDING });
      mockedExpenseModel.findById.mockResolvedValue(expense);

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Only rejected expenses can be resubmitted');
      expect(mockedExpenseModel.resubmit).not.toHaveBeenCalled();
    });

    it('should return 409 on optimistic-version conflict (resubmit → CONFLICT)', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({ result: 'CONFLICT', expense: null, appliedFields: [] });

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toContain('modified by another request');
      expect(mockedAuditLogModel.create).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should return 404 when the row vanished between read and resubmit (NOT_FOUND)', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({ result: 'NOT_FOUND', expense: null, appliedFields: [] });

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Expense not found');
      expect(mockedAuditLogModel.create).not.toHaveBeenCalled();
    });

    it('should return 409 when status changed under the read (NOT_REJECTED race)', async () => {
      const expense = mockExpense({ submitted_by: 1, status: Status.REJECTED, version: 3 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedExpenseModel.resubmit.mockResolvedValue({ result: 'NOT_REJECTED', expense: null, appliedFields: [] });

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Only rejected expenses can be resubmitted');
      expect(mockedAuditLogModel.create).not.toHaveBeenCalled();
    });

    it('should call next(err) when the model throws', async () => {
      const dbError = new Error('DB error');
      mockedExpenseModel.findById.mockRejectedValue(dbError);

      const req = mockRequest({ params: { id: '10' }, body: resubmitBody });
      const res = mockResponse();

      await resubmitExpense(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────
  // exportMyExpenses  (CSV export, scoped to the caller)
  // ────────────────────────────────────────────────────────────

  describe('exportMyExpenses', () => {
    const CSV_HEADER = 'ID,Title,Category,Amount,Currency,Date,Status,Filed';
    const UTF8_BOM = '﻿';

    it('should scope the export to the requesting user\'s id', async () => {
      mockedExpenseModel.findByUserIdForExport.mockResolvedValue({ data: [], capped: false });

      const req = mockRequest({ user: mockUser({ id: 7 }), query: {} });
      const res = mockResponse();

      await exportMyExpenses(req as Request, res as Response, next);

      expect(mockedExpenseModel.findByUserIdForExport).toHaveBeenCalledTimes(1);
      expect(mockedExpenseModel.findByUserIdForExport.mock.calls[0][0]).toBe(7);
      expect(next).not.toHaveBeenCalled();
    });

    it('should set CSV content-type and an attachment Content-Disposition header', async () => {
      const expense = mockExpense({ id: 10, title: 'Lunch', status: Status.APPROVED });
      mockedExpenseModel.findByUserIdForExport.mockResolvedValue({ data: [expense], capped: false });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportMyExpenses(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="my-expenses.csv"',
      );
    });

    it('should emit a UTF-8 BOM + header row, then one CRLF-terminated row per expense', async () => {
      const expense = mockExpense({ id: 42, title: 'Hotel', category: Category.TRAVEL, status: Status.APPROVED });
      mockedExpenseModel.findByUserIdForExport.mockResolvedValue({ data: [expense], capped: false });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportMyExpenses(req as Request, res as Response, next);

      const body = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(body.startsWith(UTF8_BOM)).toBe(true);
      expect(body).toContain(CSV_HEADER);
      // header row + one data row + trailing CRLF
      expect(body.split('\r\n').filter((l) => l.length > 0)).toHaveLength(2);
      expect(body).toContain('42,Hotel,TRAVEL,');
    });

    it('should neutralize spreadsheet-injection payloads via the injection-safe csv util', async () => {
      // A title beginning with "=" is a live formula in Excel/Sheets; the csv util
      // must prefix it with an apostrophe so it is treated as literal text.
      const expense = mockExpense({ id: 1, title: '=1+1', status: Status.APPROVED });
      mockedExpenseModel.findByUserIdForExport.mockResolvedValue({ data: [expense], capped: false });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportMyExpenses(req as Request, res as Response, next);

      const body = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(body).toContain("'=1+1");
      expect(body).not.toMatch(/,=1\+1,/);
    });

    it('should still return a valid CSV (header row only) when there are no expenses', async () => {
      mockedExpenseModel.findByUserIdForExport.mockResolvedValue({ data: [], capped: false });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportMyExpenses(req as Request, res as Response, next);

      const body = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(body).toBe(`${UTF8_BOM}${CSV_HEADER}\r\n`);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    });

    it('should call next(err) when the model throws', async () => {
      const dbError = new Error('DB error');
      mockedExpenseModel.findByUserIdForExport.mockRejectedValue(dbError);

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await exportMyExpenses(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
