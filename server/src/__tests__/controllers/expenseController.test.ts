import { Request, Response, NextFunction } from 'express';
import { expenseModel } from '../../models/expense';
import { auditLogModel } from '../../models/auditLog';
import { createExpense, getExpenses, getExpenseById, updateExpense, deleteExpense } from '../../controllers/expenseController';
import { Status, AuditAction, Category, Role, Expense, AuditLog } from '../../types';
import { AppError } from '../../utils/errors';

// ── Mock models ────────────────────────────────────────────────

jest.mock('../../models/expense');
jest.mock('../../models/auditLog');
jest.mock('../../models/receipt');
jest.mock('../../models/user');
jest.mock('../../services/graphApi');

import { receiptModel } from '../../models/receipt';
import { userModel } from '../../models/user';
import { graphApiService } from '../../services/graphApi';

const mockedExpenseModel = expenseModel as jest.Mocked<typeof expenseModel>;
const mockedAuditLogModel = auditLogModel as jest.Mocked<typeof auditLogModel>;
const mockedReceiptModel = receiptModel as jest.Mocked<typeof receiptModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;

// ── Helpers ────────────────────────────────────────────────────

const mockUser = (overrides: Partial<Request['user']> = {}): Request['user'] => ({
  id: 1,
  role: Role.EMPLOYEE,
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
      const auditLog = mockAuditLog();
      mockedExpenseModel.create.mockResolvedValue(expense);
      mockedAuditLogModel.create.mockResolvedValue(auditLog);

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.create).toHaveBeenCalledWith({
        submitted_by: 1,
        title: 'Flight to NYC',
        description: 'Business trip',
        amount: 450.00,
        currency: 'USD',
        category: Category.TRAVEL,
        expense_date: '2026-03-01',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { ...expense, receipts: [] } });
    });

    it('should create a SUBMITTED audit log entry', async () => {
      const expense = mockExpense();
      mockedExpenseModel.create.mockResolvedValue(expense);
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog());

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(mockedAuditLogModel.create).toHaveBeenCalledWith({
        expense_id: expense.id,
        action: AuditAction.SUBMITTED,
        performed_by: 1,
        old_status: null,
        new_status: Status.PENDING,
        ip_address: '127.0.0.1',
      });
    });

    it('should set description to null when not provided', async () => {
      const bodyWithoutDesc = { ...validBody, description: undefined };
      const expense = mockExpense({ description: null });
      mockedExpenseModel.create.mockResolvedValue(expense);
      mockedAuditLogModel.create.mockResolvedValue(mockAuditLog());

      const req = mockRequest({ body: bodyWithoutDesc });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(mockedExpenseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it('should call next(err) when model throws', async () => {
      const dbError = new Error('DB connection failed');
      mockedExpenseModel.create.mockRejectedValue(dbError);

      const req = mockRequest({ body: validBody });
      const res = mockResponse();

      await createExpense(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
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
});
