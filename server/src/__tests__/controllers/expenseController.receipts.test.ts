import { Request, Response, NextFunction } from 'express';
import path from 'path';

// downloadReceipt is the only handler that touches the filesystem (fs.access to
// confirm the file exists before streaming it). Stub fs/promises so existence can
// be toggled per-test without real disk I/O. The real receiptFiles module is kept
// intact on purpose: its path-confinement logic (resolveReceiptPath) and the
// header sanitizers are exactly what these security tests must exercise.
jest.mock('fs/promises', () => ({
  __esModule: true,
  default: { access: jest.fn() },
}));

jest.mock('../../models/expense');
jest.mock('../../models/receipt');
jest.mock('../../models/user');
jest.mock('../../services/graphApi');

import fs from 'fs/promises';
import { expenseModel } from '../../models/expense';
import { receiptModel } from '../../models/receipt';
import { userModel } from '../../models/user';
import { graphApiService } from '../../services/graphApi';
import { downloadReceipt } from '../../controllers/expenseController';
import { RECEIPT_UPLOAD_DIR } from '../../utils/receiptFiles';
import { Status, Category, Role, Expense, Receipt, User } from '../../types';
import { AppError } from '../../utils/errors';

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedExpenseModel = expenseModel as jest.Mocked<typeof expenseModel>;
const mockedReceiptModel = receiptModel as jest.Mocked<typeof receiptModel>;
const mockedUserModel = userModel as jest.Mocked<typeof userModel>;
const mockedGraphApiService = graphApiService as jest.Mocked<typeof graphApiService>;

// ── Helpers ────────────────────────────────────────────────────────

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
  amount: 450.0,
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

const mockReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: 5,
  expense_id: 10,
  file_name: 'invoice.pdf',
  file_path: path.join(RECEIPT_UPLOAD_DIR, 'stored-receipt.pdf'),
  mime_type: 'application/pdf',
  file_size: 2048,
  uploaded_at: new Date(),
  ...overrides,
});

const mockSubmitter = (overrides: Partial<User> = {}): User => ({
  id: 99,
  entra_id: 'entra-employee-99',
  email: 'e99@test.com',
  display_name: 'Employee 99',
  role: Role.EMPLOYEE,
  manager_id: 1,
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> =>
  ({
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
  res.sendFile = jest.fn().mockReturnValue(undefined) as unknown as Response['sendFile'];
  return res;
};

const headerMap = (res: Partial<Response>): Record<string, string> =>
  Object.fromEntries((res.setHeader as jest.Mock).mock.calls as Array<[string, string]>);

// ── Tests ──────────────────────────────────────────────────────────

describe('expenseController.downloadReceipt', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
    // Default: the file exists on disk unless a test overrides it.
    mockedFs.access.mockResolvedValue(undefined);
  });

  // ── ID validation ────────────────────────────────────────────────

  it('returns 400 for a non-numeric expense ID', async () => {
    const req = mockRequest({ params: { id: 'abc', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid expense ID');
    expect(mockedExpenseModel.findById).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric receipt ID', async () => {
    const req = mockRequest({ params: { id: '10', receiptId: 'xyz' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid receipt ID');
    expect(mockedExpenseModel.findById).not.toHaveBeenCalled();
  });

  // ── Expense existence ────────────────────────────────────────────

  it('returns 404 when the expense does not exist', async () => {
    mockedExpenseModel.findById.mockResolvedValue(null);
    const req = mockRequest({ params: { id: '999', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Expense not found');
    expect(mockedReceiptModel.findById).not.toHaveBeenCalled();
  });

  // ── Owner can download ───────────────────────────────────────────

  it('streams the receipt to its owner with download-forcing security headers', async () => {
    const expense = mockExpense({ submitted_by: 1 });
    const receipt = mockReceipt({ file_name: 'invoice.pdf', mime_type: 'application/pdf' });
    mockedExpenseModel.findById.mockResolvedValue(expense);
    mockedReceiptModel.findById.mockResolvedValue(receipt);

    const req = mockRequest({ params: { id: '10', receiptId: '5' }, user: mockUser({ id: 1 }) });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    // No cross-user authorization check runs for the owner.
    expect(mockedUserModel.findById).not.toHaveBeenCalled();
    expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();

    const headers = headerMap(res);
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    // Forced as an attachment (never inline) so a malicious PDF can't run in-browser.
    expect(headers['Content-Disposition']).toContain('attachment;');
    expect(headers['Content-Disposition']).toContain('filename="invoice.pdf"');

    expect(res.sendFile).toHaveBeenCalledTimes(1);
    expect(res.sendFile).toHaveBeenCalledWith(path.join(RECEIPT_UPLOAD_DIR, 'stored-receipt.pdf'));
  });

  // ── Cross-user access control ────────────────────────────────────

  it('returns 403 when a plain EMPLOYEE requests someone else\'s receipt', async () => {
    const expense = mockExpense({ submitted_by: 99 });
    mockedExpenseModel.findById.mockResolvedValue(expense);

    const req = mockRequest({
      params: { id: '10', receiptId: '5' },
      user: mockUser({ id: 1, role: Role.EMPLOYEE }),
    });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    // Denied before the receipt is ever looked up or streamed.
    expect(mockedReceiptModel.findById).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('lets a MANAGER download a direct report\'s receipt (verified live via Graph)', async () => {
    const expense = mockExpense({ submitted_by: 99 });
    const receipt = mockReceipt();
    mockedExpenseModel.findById.mockResolvedValue(expense);
    mockedReceiptModel.findById.mockResolvedValue(receipt);
    mockedUserModel.findById.mockResolvedValue(mockSubmitter());
    mockedGraphApiService.isManagerOf.mockResolvedValue(true);

    const req = mockRequest({
      params: { id: '10', receiptId: '5' },
      headers: { authorization: 'Bearer token-123' },
      user: mockUser({ id: 1, role: Role.MANAGER }),
    });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    expect(mockedGraphApiService.isManagerOf).toHaveBeenCalledWith(1, 'entra-employee-99', 'token-123', {
      allowCachedFallback: false,
      forceRefresh: true,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when a MANAGER requests a receipt outside their reporting chain', async () => {
    const expense = mockExpense({ submitted_by: 99 });
    mockedExpenseModel.findById.mockResolvedValue(expense);
    mockedUserModel.findById.mockResolvedValue(mockSubmitter({ manager_id: 2 }));
    mockedGraphApiService.isManagerOf.mockResolvedValue(false);

    const req = mockRequest({
      params: { id: '10', receiptId: '5' },
      headers: { authorization: 'Bearer token-123' },
      user: mockUser({ id: 1, role: Role.MANAGER }),
    });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(403);
    expect(mockedReceiptModel.findById).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('lets an ADMIN download any receipt without a Graph chain check', async () => {
    const expense = mockExpense({ submitted_by: 99 });
    const receipt = mockReceipt();
    mockedExpenseModel.findById.mockResolvedValue(expense);
    mockedReceiptModel.findById.mockResolvedValue(receipt);

    const req = mockRequest({
      params: { id: '10', receiptId: '5' },
      user: mockUser({ id: 1, role: Role.ADMIN }),
    });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    expect(mockedGraphApiService.isManagerOf).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledTimes(1);
  });

  // ── Receipt existence / ownership binding ────────────────────────

  it('returns 404 when the receipt id does not exist', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));
    mockedReceiptModel.findById.mockResolvedValue(null);

    const req = mockRequest({ params: { id: '10', receiptId: '777' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Receipt not found');
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('returns 404 when the receipt belongs to a DIFFERENT expense (no IDOR across expenses)', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ id: 10, submitted_by: 1 }));
    // Receipt exists but is bound to expense 11, not the requested 10.
    mockedReceiptModel.findById.mockResolvedValue(mockReceipt({ expense_id: 11 }));

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Receipt not found');
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  // ── MIME allowlist on stored row ─────────────────────────────────

  it('returns 400 when the stored receipt has a disallowed mime type', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));
    mockedReceiptModel.findById.mockResolvedValue(mockReceipt({ mime_type: 'text/html' }));

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid receipt file type');
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  // ── Path-safety / confinement ────────────────────────────────────

  it('returns 404 (and never streams) when the stored file_path escapes the uploads dir', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));
    // A poisoned DB row whose path traverses out of the receipts directory.
    mockedReceiptModel.findById.mockResolvedValue(
      mockReceipt({ file_path: path.join(RECEIPT_UPLOAD_DIR, '..', '..', 'etc', 'passwd') }),
    );

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Receipt file not found');
    // Confinement is enforced BEFORE any disk access or streaming.
    expect(mockedFs.access).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('returns 404 (and never streams) for an absolute file_path outside the uploads dir', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));
    mockedReceiptModel.findById.mockResolvedValue(mockReceipt({ file_path: '/etc/shadow' }));

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Receipt file not found');
    expect(mockedFs.access).not.toHaveBeenCalled();
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  it('returns 404 when the (confined) file is missing from disk', async () => {
    mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 1 }));
    mockedReceiptModel.findById.mockResolvedValue(mockReceipt());
    mockedFs.access.mockRejectedValue(new Error('ENOENT'));

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Receipt file not found');
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  // ── Header-injection sanitization ────────────────────────────────

  it('sanitizes a malicious file_name so it cannot inject response headers', async () => {
    const expense = mockExpense({ submitted_by: 1 });
    // file_name ultimately derives from attacker-controlled originalname.
    const receipt = mockReceipt({ file_name: 'a"b;c\r\nSet-Cookie: x.pdf', mime_type: 'application/pdf' });
    mockedExpenseModel.findById.mockResolvedValue(expense);
    mockedReceiptModel.findById.mockResolvedValue(receipt);

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    const disposition = headerMap(res)['Content-Disposition'];
    // No raw quotes / CR / LF survive into the header value.
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toContain('filename="a_b_c__Set-Cookie_ x.pdf"');
    expect(res.sendFile).toHaveBeenCalledTimes(1);
  });

  // ── Error propagation ────────────────────────────────────────────

  it('forwards unexpected model errors to next()', async () => {
    const dbError = new Error('DB connection failed');
    mockedExpenseModel.findById.mockRejectedValue(dbError);

    const req = mockRequest({ params: { id: '10', receiptId: '5' } });
    const res = mockResponse();

    await downloadReceipt(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.sendFile).not.toHaveBeenCalled();
  });
});
