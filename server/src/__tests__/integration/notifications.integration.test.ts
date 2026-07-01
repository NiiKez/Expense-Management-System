/**
 * Integration test — Notification ownership scoping.
 *
 * The notification routes had zero HTTP coverage. Every read and mutation is
 * scoped in the model by `WHERE user_id = ?`; this proves that boundary end to
 * end: user A only ever sees/counts A's notifications, and A cannot mark B's
 * notification read (it 404s and B's row stays unread).
 */

import { Request, Response, NextFunction } from 'express';
import pool from '../../config/db';
import {
  MockUserPayload,
  EMPLOYEE_USER as USER_A,
  MANAGER_USER as USER_B,
  seedTestUsers,
  cleanTestData,
  teardownTestDb,
} from './setup';

let currentMockUser: MockUserPayload | null = USER_A;

jest.mock('../../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    if (!currentMockUser) {
      const { unauthorized } = require('../../utils/errors');
      next(unauthorized('Missing or malformed Authorization header'));
      return;
    }
    req.user = { ...currentMockUser };
    next();
  },
}));

jest.mock('../../services/graphApi', () => ({
  graphApiService: {
    isManagerOf: jest.fn().mockResolvedValue(true),
    getManager: jest.fn().mockResolvedValue(null),
    getDirectReports: jest.fn().mockResolvedValue([]),
  },
  isGraphApiAuthError: () => false,
}));

import supertest from 'supertest';
import app from '../../app';

const request = supertest(app);

function actAs(user: MockUserPayload | null): void {
  currentMockUser = user;
}

const B_ONLY_MESSAGE = 'B-ONLY-SECRET-NOTIFICATION';

async function insertNotification(userId: number, message: string): Promise<number> {
  const [result] = await pool.execute(
    `INSERT INTO notifications (user_id, type, message) VALUES (?, 'EXPENSE_APPROVED', ?)`,
    [userId, message],
  );
  return (result as { insertId: number }).insertId;
}

let bNotificationId = 0;

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await cleanTestData();
  // A gets two notifications, B gets one.
  await insertNotification(USER_A.id, 'A-notification-1');
  await insertNotification(USER_A.id, 'A-notification-2');
  bNotificationId = await insertNotification(USER_B.id, B_ONLY_MESSAGE);
  actAs(USER_A);
});

describe('Notification ownership scoping', () => {
  it('unauthenticated GET /notifications → 401', async () => {
    actAs(null);
    const res = await request.get('/api/v1/notifications');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /notifications returns ONLY the caller\'s own notifications', async () => {
    actAs(USER_A);
    const res = await request.get('/api/v1/notifications');

    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ user_id: number; message: string }>;
    expect(rows.length).toBe(2);
    // Never any of B's rows.
    for (const row of rows) {
      expect(row.user_id).toBe(USER_A.id);
      expect(row.message).not.toBe(B_ONLY_MESSAGE);
    }
    expect(res.body.pagination.total).toBe(2);
  });

  it('unread-count reflects ONLY the caller\'s notifications', async () => {
    actAs(USER_A);
    const res = await request.get('/api/v1/notifications/unread-count');

    expect(res.status).toBe(200);
    // A has exactly two unread; B's one is not counted.
    expect(res.body.data.count).toBe(2);
  });

  it('A cannot mark B\'s notification read: 404 and B\'s row stays unread', async () => {
    actAs(USER_A);
    const res = await request.patch(`/api/v1/notifications/${bNotificationId}/read`);

    // The model's WHERE user_id = ? matches nothing, so the controller 404s.
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    // Re-query the DB: B's notification must still be unread.
    const [rows] = await pool.execute(
      'SELECT is_read FROM notifications WHERE id = ?',
      [bNotificationId],
    );
    const stored = rows as Array<{ is_read: number }>;
    expect(stored.length).toBe(1);
    expect(Number(stored[0].is_read)).toBe(0);
  });
});
