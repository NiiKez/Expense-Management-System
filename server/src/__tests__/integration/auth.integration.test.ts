/**
 * Integration test — Auth + RBAC enforcement.
 *
 * Verifies that role-based access control works end-to-end through the
 * HTTP stack with a real MySQL database. Employee tokens cannot reach
 * manager/admin endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import { Status } from '../../types';
import {
  MockUserPayload,
  EMPLOYEE_USER,
  MANAGER_USER,
  ADMIN_USER,
  seedTestUsers,
  linkManagerReport,
  cleanTestData,
  teardownTestDb,
} from './setup';

// ── Track which user the next request should authenticate as ──
let currentMockUser: MockUserPayload | null = EMPLOYEE_USER;

// ── Mock authenticate middleware ──────────────────────────────
// When currentMockUser is null, simulate "no token" → 401
jest.mock('../../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    if (!currentMockUser) {
      // Simulate what the real middleware does for missing/invalid tokens
      const { unauthorized } = require('../../utils/errors');
      next(unauthorized('Missing or malformed Authorization header'));
      return;
    }
    req.user = { ...currentMockUser };
    next();
  },
}));

// ── Mock Graph API service ────────────────────────────────────
jest.mock('../../services/graphApi', () => ({
  graphApiService: {
    isManagerOf: jest.fn().mockResolvedValue(true),
    getManager: jest.fn().mockResolvedValue(null),
    getDirectReports: jest.fn().mockResolvedValue([]),
  },
}));

// ── Import app AFTER mocks ────────────────────────────────────
import supertest from 'supertest';
import app from '../../app';

const request = supertest(app);

function actAs(user: MockUserPayload | null) {
  currentMockUser = user;
}

// ── Setup / Teardown ──────────────────────────────────────────

beforeAll(async () => {
  await seedTestUsers();
  // The manager-role tests below have MANAGER_USER act on EMPLOYEE_USER's expenses;
  // under stub auth that authorization is granted via the cached manager_id, so wire
  // up the reporting line. Kept suite-local so other suites (e.g. stats) keep the
  // NULL-manager baseline.
  await linkManagerReport(EMPLOYEE_USER.id, MANAGER_USER.id);
});

afterAll(async () => {
  await teardownTestDb();
});

// ── Tests ─────────────────────────────────────────────────────

describe('Auth + RBAC Integration', () => {
  beforeEach(async () => {
    await cleanTestData();
    actAs(EMPLOYEE_USER);
  });

  // ────────────────────────────────────────────────────────────
  // Unauthenticated access
  // ────────────────────────────────────────────────────────────

  describe('Unauthenticated requests', () => {
    it('should allow unauthenticated access to /api/v1/health', async () => {
      actAs(null);
      const res = await request.get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('should return 401 for unauthenticated access to /api/v1/expenses', async () => {
      actAs(null);
      const res = await request.get('/api/v1/expenses');
      expect(res.status).toBe(401);
    });

    it('should return 401 for unauthenticated access to /api/v1/approvals/pending', async () => {
      actAs(null);
      const res = await request.get('/api/v1/approvals/pending');
      expect(res.status).toBe(401);
    });

    it('should return 401 for unauthenticated access to /api/v1/me', async () => {
      actAs(null);
      const res = await request.get('/api/v1/me');
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Employee cannot access manager/admin endpoints
  // ────────────────────────────────────────────────────────────

  describe('Employee role restrictions', () => {
    it('should return 403 when employee accesses GET /api/v1/approvals/pending', async () => {
      actAs(EMPLOYEE_USER);
      const res = await request.get('/api/v1/approvals/pending');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should return 403 when employee tries to approve an expense', async () => {
      // Create an expense first
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Test Expense',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Employee tries to approve → 403 (RBAC blocks)
      const approveRes = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(403);
    });

    it('should return 403 when employee tries to reject an expense', async () => {
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Test Expense',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      const rejectRes = await request
        .patch(`/api/v1/approvals/${expenseId}/reject`)
        .send({ reason: 'Employee should not be able to do this' });

      expect(rejectRes.status).toBe(403);
    });

    it('should allow employee to access own expenses', async () => {
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'My Expense',
          amount: 50,
          currency: 'USD',
          category: 'MEALS',
          expense_date: '2026-04-01',
        });

      expect(createRes.status).toBe(201);

      const listRes = await request.get('/api/v1/expenses');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data).toHaveLength(1);
    });

    it('should return 403 when employee views another user\'s expense', async () => {
      // Manager creates an expense
      actAs(MANAGER_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Manager Expense',
          amount: 200,
          currency: 'USD',
          category: 'TRAVEL',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Employee tries to view it
      actAs(EMPLOYEE_USER);
      const getRes = await request.get(`/api/v1/expenses/${expenseId}`);

      expect(getRes.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Manager role access
  // ────────────────────────────────────────────────────────────

  describe('Manager role access', () => {
    it('should allow manager to access GET /api/v1/approvals/pending', async () => {
      actAs(MANAGER_USER);
      const res = await request.get('/api/v1/approvals/pending');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow manager to approve an expense from another user', async () => {
      // Employee creates
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'For Manager Approval',
          amount: 300,
          currency: 'USD',
          category: 'EQUIPMENT',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Manager approves
      actAs(MANAGER_USER);
      const approveRes = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe(Status.APPROVED);
    });

    it('should allow manager to view another user\'s expense by ID', async () => {
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Visible to Manager',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      actAs(MANAGER_USER);
      const getRes = await request.get(`/api/v1/expenses/${expenseId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.title).toBe('Visible to Manager');
    });
  });

  // ────────────────────────────────────────────────────────────
  // Manager scope — DENY path (the actual security boundary)
  //
  // The happy-path tests above wire EMPLOYEE_USER → MANAGER_USER as a reporting
  // line, so a manager approving that report succeeds. These tests prove the
  // converse: a manager must NOT approve/reject expenses outside their team, and
  // must not approve their own. ADMIN_USER has manager_id = NULL (seedTestUsers
  // never links it), so it is a non-report submitter without mutating the shared
  // EMPLOYEE→MANAGER link other tests depend on.
  // ────────────────────────────────────────────────────────────

  describe('Manager scope enforcement (deny path)', () => {
    it('should return 403 when a manager approves an expense from a non-report', async () => {
      // ADMIN_USER (manager_id = NULL) submits — MANAGER_USER does not manage them.
      actAs(ADMIN_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Not in Manager team',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });
      expect(createRes.status).toBe(201);
      const expenseId = createRes.body.data.id;

      actAs(MANAGER_USER);
      const approveRes = await request.patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(403);
      expect(approveRes.body.success).toBe(false);
    });

    it('should return 403 when a manager rejects an expense from a non-report', async () => {
      actAs(ADMIN_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Not in Manager team (reject)',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });
      const expenseId = createRes.body.data.id;

      actAs(MANAGER_USER);
      const rejectRes = await request
        .patch(`/api/v1/approvals/${expenseId}/reject`)
        .send({ reason: 'Out of scope for this manager' });

      expect(rejectRes.status).toBe(403);
      expect(rejectRes.body.success).toBe(false);
    });

    it('should return 403 when a manager approves their own expense', async () => {
      actAs(MANAGER_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Manager self-approval attempt',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });
      const expenseId = createRes.body.data.id;

      const approveRes = await request.patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(403);
      expect(approveRes.body.success).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Admin role access
  // ────────────────────────────────────────────────────────────

  describe('Admin role access', () => {
    it('should allow admin to access approval endpoints', async () => {
      actAs(ADMIN_USER);
      const res = await request.get('/api/v1/approvals/pending');

      expect(res.status).toBe(200);
    });

    it('should allow admin to approve expenses from any user', async () => {
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Admin Approval Test',
          amount: 500,
          currency: 'USD',
          category: 'SOFTWARE',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      actAs(ADMIN_USER);
      const approveRes = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe(Status.APPROVED);
      expect(approveRes.body.data.approved_by).toBe(ADMIN_USER.id);
    });

    it('should allow admin to view any expense', async () => {
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Any Expense',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      actAs(ADMIN_USER);
      const getRes = await request.get(`/api/v1/expenses/${expenseId}`);

      expect(getRes.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Cross-role ownership enforcement
  // ────────────────────────────────────────────────────────────

  describe('Cross-role ownership enforcement', () => {
    it('should not allow employee to update another employee\'s expense', async () => {
      // User 1 creates
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'User 1 Expense',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Different employee tries to update — need a user that exists in DB
      // We'll use the manager acting as a different user attempting ownership bypass
      // But actually the test needs a 4th user. Let's use a user ID that exists
      // (manager user ID=2) but with EMPLOYEE role to test ownership enforcement.
      actAs({ ...EMPLOYEE_USER, id: MANAGER_USER.id, email: 'manager-as-employee@test.com' });
      const updateRes = await request
        .put(`/api/v1/expenses/${expenseId}`)
        .send({ title: 'Hijacked' });

      expect(updateRes.status).toBe(403);
    });

    it('should not allow employee to delete another employee\'s expense', async () => {
      actAs(EMPLOYEE_USER);
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'User 1 Expense',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      actAs({ ...EMPLOYEE_USER, id: MANAGER_USER.id, email: 'manager-as-employee@test.com' });
      const delRes = await request.delete(`/api/v1/expenses/${expenseId}`);

      expect(delRes.status).toBe(403);
    });
  });
});
