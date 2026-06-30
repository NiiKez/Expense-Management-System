import { Request, Response, NextFunction } from 'express';
import { getComments, addComment } from '../../controllers/commentController';
import { expenseModel } from '../../models/expense';
import { commentModel } from '../../models/comment';
import { ensureCanAccessExpense } from '../../services/managerAuthorization';
import { notificationService } from '../../services/notificationService';
import { Role, Status, Category, Expense, Comment } from '../../types';
import { AppError, forbidden } from '../../utils/errors';

jest.mock('../../models/expense');
jest.mock('../../models/comment');
jest.mock('../../services/managerAuthorization');
jest.mock('../../services/notificationService');

const mockedExpenseModel = expenseModel as jest.Mocked<typeof expenseModel>;
const mockedCommentModel = commentModel as jest.Mocked<typeof commentModel>;
const mockedEnsureCanAccessExpense = ensureCanAccessExpense as jest.MockedFunction<
  typeof ensureCanAccessExpense
>;
const mockedNotificationService = notificationService as jest.Mocked<typeof notificationService>;

const mockExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 10,
  submitted_by: 99,
  title: 'Conference ticket',
  description: null,
  amount: 200,
  currency: 'USD',
  category: Category.TRAINING,
  expense_date: new Date('2026-03-01'),
  status: Status.PENDING,
  approved_by: null,
  rejection_reason: null,
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

const mockComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 1,
  expense_id: 10,
  author_id: 5,
  body: 'Looks fine',
  author_name: 'Manager',
  author_role: Role.MANAGER,
  created_at: new Date(),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  // Caller (id 5) is NOT the submitter (id 99): access must run through the RBAC gate.
  user: { id: 5, role: Role.MANAGER, assignedRoles: [Role.MANAGER], email: 'manager@test.com', display_name: 'Manager' },
  headers: {},
  params: { id: '10' },
  body: {},
  query: {},
  ...overrides,
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('commentController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    // resetAllMocks so a mockRejectedValue on the RBAC gate cannot leak forward.
    jest.resetAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // getComments
  // ────────────────────────────────────────────────────────────────

  describe('getComments', () => {
    it('returns 400 for a non-numeric expense ID and never touches the model', async () => {
      const req = mockRequest({ params: { id: 'abc' } });
      const res = mockResponse();

      await getComments(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedExpenseModel.findById).not.toHaveBeenCalled();
    });

    it('returns 404 when the expense does not exist (before the RBAC gate)', async () => {
      mockedExpenseModel.findById.mockResolvedValue(null);

      const req = mockRequest();
      const res = mockResponse();

      await getComments(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(mockedEnsureCanAccessExpense).not.toHaveBeenCalled();
      expect(mockedCommentModel.findByExpenseId).not.toHaveBeenCalled();
    });

    it('returns 403 and does NOT list comments when the RBAC gate denies access', async () => {
      mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 99 }));
      mockedEnsureCanAccessExpense.mockRejectedValue(forbidden());

      const req = mockRequest();
      const res = mockResponse();

      await getComments(req as Request, res as Response, next);

      // Gate was consulted with the expense submitter, then denied.
      expect(mockedEnsureCanAccessExpense).toHaveBeenCalledWith(req, 99);
      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(403);
      expect(mockedCommentModel.findByExpenseId).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('lists serialized comments when the RBAC gate permits access', async () => {
      mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 99 }));
      mockedEnsureCanAccessExpense.mockResolvedValue(undefined);
      mockedCommentModel.findByExpenseId.mockResolvedValue([mockComment()]);

      const req = mockRequest();
      const res = mockResponse();

      await getComments(req as Request, res as Response, next);

      expect(mockedEnsureCanAccessExpense).toHaveBeenCalledWith(req, 99);
      expect(mockedCommentModel.findByExpenseId).toHaveBeenCalledWith(10);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [
          expect.objectContaining({ id: 1, expense_id: 10, author_id: 5, body: 'Looks fine' }),
        ],
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      mockedExpenseModel.findById.mockResolvedValue(mockExpense());
      mockedEnsureCanAccessExpense.mockResolvedValue(undefined);
      const dbError = new Error('comments query failed');
      mockedCommentModel.findByExpenseId.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await getComments(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // addComment
  // ────────────────────────────────────────────────────────────────

  describe('addComment', () => {
    it('returns 404 when the expense does not exist (before the RBAC gate)', async () => {
      mockedExpenseModel.findById.mockResolvedValue(null);

      const req = mockRequest({ body: { body: 'hi' } });
      const res = mockResponse();

      await addComment(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(mockedEnsureCanAccessExpense).not.toHaveBeenCalled();
      expect(mockedCommentModel.create).not.toHaveBeenCalled();
    });

    it('returns 403 and does NOT create a comment when the RBAC gate denies access', async () => {
      mockedExpenseModel.findById.mockResolvedValue(mockExpense({ submitted_by: 99 }));
      mockedEnsureCanAccessExpense.mockRejectedValue(forbidden());

      const req = mockRequest({ body: { body: 'sneaky' } });
      const res = mockResponse();

      await addComment(req as Request, res as Response, next);

      expect(mockedEnsureCanAccessExpense).toHaveBeenCalledWith(req, 99);
      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(403);
      expect(mockedCommentModel.create).not.toHaveBeenCalled();
      expect(mockedNotificationService.expenseComment).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('creates the comment (trimmed, authored by the caller) and notifies when permitted', async () => {
      const expense = mockExpense({ submitted_by: 99 });
      mockedExpenseModel.findById.mockResolvedValue(expense);
      mockedEnsureCanAccessExpense.mockResolvedValue(undefined);
      mockedCommentModel.create.mockResolvedValue(mockComment({ body: 'hello team' }));
      mockedNotificationService.expenseComment.mockResolvedValue(undefined);

      const req = mockRequest({ body: { body: '  hello team  ' } });
      const res = mockResponse();

      await addComment(req as Request, res as Response, next);

      expect(mockedEnsureCanAccessExpense).toHaveBeenCalledWith(req, 99);
      expect(mockedCommentModel.create).toHaveBeenCalledWith({
        expense_id: 10,
        author_id: 5, // req.user.id — never client-supplied
        body: 'hello team', // trimmed
      });
      expect(mockedNotificationService.expenseComment).toHaveBeenCalledWith({
        expense,
        actor: req.user,
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ id: 1, body: 'hello team' }),
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      mockedExpenseModel.findById.mockResolvedValue(mockExpense());
      mockedEnsureCanAccessExpense.mockResolvedValue(undefined);
      const dbError = new Error('comment insert failed');
      mockedCommentModel.create.mockRejectedValue(dbError);

      const req = mockRequest({ body: { body: 'hi' } });
      const res = mockResponse();

      await addComment(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
