import { Request, Response, NextFunction } from 'express';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../controllers/notificationController';
import { notificationModel } from '../../models/notification';
import { Role, NotificationType, Notification } from '../../types';
import { AppError } from '../../utils/errors';

jest.mock('../../models/notification');

const mockedNotificationModel = notificationModel as jest.Mocked<typeof notificationModel>;

// Caller id 42 is the scoping anchor: every model call must be keyed on this id.
const CALLER_ID = 42;

const mockNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 1,
  user_id: CALLER_ID,
  type: NotificationType.EXPENSE_APPROVED,
  expense_id: 10,
  actor_id: 2,
  message: 'Your expense was approved',
  is_read: 0,
  created_at: new Date(),
  ...overrides,
});

const mockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  user: { id: CALLER_ID, role: Role.EMPLOYEE, email: 'emp@test.com', display_name: 'Employee' },
  headers: {},
  params: {},
  query: {},
  ...overrides,
});

const mockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('notificationController', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
    jest.resetAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // getNotifications
  // ────────────────────────────────────────────────────────────────

  describe('getNotifications', () => {
    it('lists the CALLER\'s notifications with pagination + unread meta', async () => {
      const data = [mockNotification()];
      mockedNotificationModel.findByUserId.mockResolvedValue({ data, total: 1, unread: 1 });

      const req = mockRequest({ query: { page: '2', pageSize: '5', unread: 'true' } });
      const res = mockResponse();

      await getNotifications(req as Request, res as Response, next);

      // Scoped to req.user.id (42) — never a client-supplied user id.
      expect(mockedNotificationModel.findByUserId).toHaveBeenCalledWith(CALLER_ID, {
        unreadOnly: true,
        page: 2,
        pageSize: 5,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data,
        pagination: { total: 1, page: 2, pageSize: 5 },
        meta: { unread: 1 },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('defaults unreadOnly to false and uses default pagination', async () => {
      mockedNotificationModel.findByUserId.mockResolvedValue({ data: [], total: 0, unread: 0 });

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await getNotifications(req as Request, res as Response, next);

      expect(mockedNotificationModel.findByUserId).toHaveBeenCalledWith(CALLER_ID, {
        unreadOnly: false,
        page: 1,
        pageSize: 20,
      });
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('notification list failed');
      mockedNotificationModel.findByUserId.mockRejectedValue(dbError);

      const req = mockRequest({ query: {} });
      const res = mockResponse();

      await getNotifications(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getUnreadCount
  // ────────────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns the caller\'s unread count', async () => {
      mockedNotificationModel.countUnread.mockResolvedValue(3);

      const req = mockRequest();
      const res = mockResponse();

      await getUnreadCount(req as Request, res as Response, next);

      expect(mockedNotificationModel.countUnread).toHaveBeenCalledWith(CALLER_ID);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { count: 3 } });
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('count failed');
      mockedNotificationModel.countUnread.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await getUnreadCount(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // markNotificationRead
  // ────────────────────────────────────────────────────────────────

  describe('markNotificationRead', () => {
    it('returns 400 for a non-numeric id and never touches the model', async () => {
      const req = mockRequest({ params: { id: 'abc' } });
      const res = mockResponse();

      await markNotificationRead(req as Request, res as Response, next);

      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(400);
      expect(mockedNotificationModel.markRead).not.toHaveBeenCalled();
    });

    it('marks the notification read, scoping the update to the caller', async () => {
      mockedNotificationModel.markRead.mockResolvedValue(true);

      const req = mockRequest({ params: { id: '7' } });
      const res = mockResponse();

      await markNotificationRead(req as Request, res as Response, next);

      // id + CALLER_ID — the second arg is the owner scope, so a user can only
      // ever mark their OWN notification read.
      expect(mockedNotificationModel.markRead).toHaveBeenCalledWith(7, CALLER_ID);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('returns 404 when the notification belongs to another user (ownership scoping)', async () => {
      // A foreign notification id is never matched because the model WHERE clause
      // is scoped to user_id = CALLER_ID, so markRead returns false.
      mockedNotificationModel.markRead.mockResolvedValue(false);

      const req = mockRequest({ params: { id: '7' } });
      const res = mockResponse();

      await markNotificationRead(req as Request, res as Response, next);

      expect(mockedNotificationModel.markRead).toHaveBeenCalledWith(7, CALLER_ID);
      const error = next.mock.calls[0][0] as unknown as AppError;
      expect(error.statusCode).toBe(404);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('mark read failed');
      mockedNotificationModel.markRead.mockRejectedValue(dbError);

      const req = mockRequest({ params: { id: '7' } });
      const res = mockResponse();

      await markNotificationRead(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // markAllNotificationsRead
  // ────────────────────────────────────────────────────────────────

  describe('markAllNotificationsRead', () => {
    it('marks all of the caller\'s notifications read and returns the count', async () => {
      mockedNotificationModel.markAllRead.mockResolvedValue(4);

      const req = mockRequest();
      const res = mockResponse();

      await markAllNotificationsRead(req as Request, res as Response, next);

      expect(mockedNotificationModel.markAllRead).toHaveBeenCalledWith(CALLER_ID);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { updated: 4 } });
    });

    it('forwards model errors to next', async () => {
      const dbError = new Error('mark all failed');
      mockedNotificationModel.markAllRead.mockRejectedValue(dbError);

      const req = mockRequest();
      const res = mockResponse();

      await markAllNotificationsRead(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(dbError);
    });
  });
});
