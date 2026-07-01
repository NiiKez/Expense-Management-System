/**
 * Integration test — Admin read/export authorization.
 *
 * The admin router gates every route behind authorize([ADMIN]). Only
 * /admin/stats had HTTP coverage; this proves the RBAC boundary for the read
 * views and the CSV exports (EMPLOYEE/MANAGER → 403, ADMIN → 200), and that a
 * successful audit-log export is recorded as an AUDIT_LOG_EXPORTED security
 * event for the acting admin.
 */

import { Request, Response, NextFunction } from 'express';
import pool from '../../config/db';
import {
  MockUserPayload,
  EMPLOYEE_USER,
  MANAGER_USER,
  ADMIN_USER,
  seedTestUsers,
  cleanTestData,
  teardownTestDb,
} from './setup';

let currentMockUser: MockUserPayload | null = ADMIN_USER;

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

// Every admin surface under test.
const ADMIN_ROUTES = [
  '/api/v1/admin/expenses',
  '/api/v1/admin/users',
  '/api/v1/admin/audit-logs',
  '/api/v1/admin/expenses/export',
  '/api/v1/admin/audit-logs/export',
] as const;

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await cleanTestData();
  actAs(ADMIN_USER);
});

describe('Admin routes authorization', () => {
  describe.each(ADMIN_ROUTES)('GET %s', (route) => {
    it('EMPLOYEE → 403', async () => {
      actAs(EMPLOYEE_USER);
      const res = await request.get(route);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('MANAGER → 403', async () => {
      actAs(MANAGER_USER);
      const res = await request.get(route);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('ADMIN → 200', async () => {
      actAs(ADMIN_USER);
      const res = await request.get(route);
      expect(res.status).toBe(200);
    });
  });

  describe('Privileged-export audit trail', () => {
    it('a successful ADMIN audit-log export writes an AUDIT_LOG_EXPORTED security event', async () => {
      actAs(ADMIN_USER);
      const requestId = `admin-auditexport-${Date.now()}`;
      const res = await request
        .get('/api/v1/admin/audit-logs/export')
        .set('X-Request-Id', requestId);

      expect(res.status).toBe(200);

      const [rows] = await pool.execute(
        `SELECT event_type, outcome, user_id FROM security_events
          WHERE request_id = ? AND event_type = 'AUDIT_LOG_EXPORTED'`,
        [requestId],
      );
      const events = rows as Array<{ outcome: string; user_id: number }>;
      expect(events.length).toBe(1);
      expect(events[0].outcome).toBe('SUCCESS');
      expect(events[0].user_id).toBe(ADMIN_USER.id);
    });

    it('the expenses export succeeds for an ADMIN (no security event is emitted for it by design)', async () => {
      actAs(ADMIN_USER);
      const requestId = `admin-expexport-${Date.now()}`;
      const res = await request
        .get('/api/v1/admin/expenses/export')
        .set('X-Request-Id', requestId);

      expect(res.status).toBe(200);

      const [rows] = await pool.execute(
        `SELECT id FROM security_events WHERE request_id = ?`,
        [requestId],
      );
      // exportAllExpenses intentionally does not log a security event (only the
      // audit-log export does), so there is no row for this request.
      expect((rows as unknown[]).length).toBe(0);
    });
  });
});
