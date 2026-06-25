import { Request, Response, NextFunction } from 'express';
import { getMe, updateMyPreferences } from '../../controllers/meController';
import { userModel } from '../../models/user';
import { Role, User } from '../../types';
import { AppError } from '../../utils/errors';

jest.mock('../../models/user');

const mockedUserModel = userModel as jest.Mocked<typeof userModel>;

const CALLER_ID = 3;

const mockUserRow = (overrides: Partial<User> = {}): User => ({
  id: CALLER_ID,
  entra_id: 'entra-3',
  email: 'me@test.com',
  display_name: 'Me',
  role: Role.EMPLOYEE,
  manager_id: null,
  is_active: true,
  // MySQL returns BOOLEAN columns as 0/1 — exercise the controller's coercion.
  default_currency: 'EUR',
  notify_on_submission: 1,
  notify_on_decision: 0,
  notify_on_comment: 1,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: { id: CALLER_ID, role: Role.EMPLOYEE, email: 'me@test.com', display_name: 'Me' },
  headers: {},
  params: {},
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

describe('meController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.resetAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // getMe
  // ────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns 404 when the caller row is gone', async () => {
      mockedUserModel.findById.mockResolvedValue(null);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.findById).toHaveBeenCalledWith(CALLER_ID);
      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('serializes the caller and coerces 0/1 preference flags to real booleans', async () => {
      mockedUserModel.findById.mockResolvedValue(mockUserRow());

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.findById).toHaveBeenCalledWith(CALLER_ID);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: CALLER_ID,
          email: 'me@test.com',
          role: Role.EMPLOYEE,
          manager_id: null,
          manager_name: null,
          default_currency: 'EUR',
          notify_on_submission: true, // 1 -> true
          notify_on_decision: false, // 0 -> false
          notify_on_comment: true, // 1 -> true
        }),
      });
      // Booleans must be real primitives, not 1/0.
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.notify_on_decision).toStrictEqual(false);
      expect(payload.notify_on_submission).toStrictEqual(true);
    });

    it('defaults absent preference flags to true (column DEFAULT TRUE)', async () => {
      mockedUserModel.findById.mockResolvedValue(
        mockUserRow({
          default_currency: undefined,
          notify_on_submission: undefined,
          notify_on_decision: undefined,
          notify_on_comment: undefined,
        }),
      );

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.default_currency).toBeNull();
      expect(payload.notify_on_submission).toBe(true);
      expect(payload.notify_on_decision).toBe(true);
      expect(payload.notify_on_comment).toBe(true);
    });

    it('resolves the manager display name for the read-only profile section', async () => {
      mockedUserModel.findById
        .mockResolvedValueOnce(mockUserRow({ manager_id: 8 }))
        .mockResolvedValueOnce(mockUserRow({ id: 8, display_name: 'Boss', manager_id: null }));

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(mockedUserModel.findById).toHaveBeenNthCalledWith(1, CALLER_ID);
      expect(mockedUserModel.findById).toHaveBeenNthCalledWith(2, 8);
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.manager_id).toBe(8);
      expect(payload.manager_name).toBe('Boss');
    });

    it('leaves manager_name null when the manager row cannot be loaded', async () => {
      mockedUserModel.findById
        .mockResolvedValueOnce(mockUserRow({ manager_id: 8 }))
        .mockResolvedValueOnce(null);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.manager_name).toBeNull();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('user lookup failed');
      mockedUserModel.findById.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await getMe(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // updateMyPreferences
  // ────────────────────────────────────────────────────────────────

  describe('updateMyPreferences', () => {
    it('returns 404 when the caller row is gone', async () => {
      mockedUserModel.updatePreferences.mockResolvedValue(null);

      const req = mockRequest({ body: { notify_on_comment: false } });
      const res = mockResponse();

      await updateMyPreferences(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('updates the caller\'s own preferences and returns coerced booleans', async () => {
      const body = { notify_on_comment: false, default_currency: 'GBP' };
      mockedUserModel.updatePreferences.mockResolvedValue(
        mockUserRow({
          default_currency: 'GBP',
          notify_on_submission: 1,
          notify_on_decision: 1,
          notify_on_comment: 0,
        }),
      );

      const req = mockRequest({ body });
      const res = mockResponse();

      await updateMyPreferences(req as Request, res as Response, next);

      // Scoped to req.user.id; the validated body is forwarded verbatim.
      expect(mockedUserModel.updatePreferences).toHaveBeenCalledWith(CALLER_ID, body);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          default_currency: 'GBP',
          notify_on_submission: true,
          notify_on_decision: true,
          notify_on_comment: false, // 0 -> false
        },
      });
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('update failed');
      mockedUserModel.updatePreferences.mockRejectedValue(dbError);

      const req = mockRequest({ body: { notify_on_decision: true } });
      const res = mockResponse();

      await updateMyPreferences(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
