import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notificationController';

const router = Router();

// All notification routes require authentication; each user only ever sees and
// mutates their own notifications (enforced in the model by user_id scoping).
router.use(authenticate);

// GET /api/v1/notifications — list current user's notifications (paginated)
router.get('/', getNotifications);

// GET /api/v1/notifications/unread-count — unread badge count
router.get('/unread-count', getUnreadCount);

// POST /api/v1/notifications/read-all — mark all as read
router.post('/read-all', markAllNotificationsRead);

// PATCH /api/v1/notifications/:id/read — mark one as read
router.patch('/:id/read', markNotificationRead);

export default router;
