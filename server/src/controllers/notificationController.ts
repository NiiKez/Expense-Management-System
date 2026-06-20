import { Request, Response, NextFunction } from 'express';
import { notificationModel } from '../models/notification';
import { notFound } from '../utils/errors';
import { parsePagination } from '../utils/pagination';
import { parsePositiveId, getSingleQueryValue } from '../utils/requestParsing';

export const getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const unreadOnly = getSingleQueryValue(req.query.unread, 'unread') === 'true';

    const result = await notificationModel.findByUserId(req.user!.id, { unreadOnly, page, pageSize });
    res.json({
      success: true,
      data: result.data,
      pagination: { total: result.total, page, pageSize },
      meta: { unread: result.unread },
    });
  } catch (err) {
    next(err);
  }
};

export const getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const count = await notificationModel.countUnread(req.user!.id);
    res.json({ success: true, data: { count } });
  } catch (err) {
    next(err);
  }
};

export const markNotificationRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parsePositiveId(req.params.id, 'notification ID');
    const ok = await notificationModel.markRead(id, req.user!.id);
    if (!ok) {
      next(notFound('Notification'));
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const markAllNotificationsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updated = await notificationModel.markAllRead(req.user!.id);
    res.json({ success: true, data: { updated } });
  } catch (err) {
    next(err);
  }
};
