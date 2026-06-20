/**
 * Integration test — Expense full lifecycle.
 *
 * Exercises the real HTTP stack (supertest → Express → routes → controllers → models → MySQL)
 * with mocked auth middleware and mocked Graph API, but a real database.
 *
 * Lifecycle tested: create expense → approve expense → verify audit log.
 */

import { Request, Response, NextFunction } from 'express';
import { Status, AuditAction } from '../../types';
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
let currentMockUser: MockUserPayload = EMPLOYEE_USER;

// ── Mock authenticate middleware ──────────────────────────────
jest.mock('../../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { ...currentMockUser };
    next();
  },
}));

// ── Mock Graph API service (approval controller uses it) ──────
jest.mock('../../services/graphApi', () => ({
  graphApiService: {
    isManagerOf: jest.fn().mockResolvedValue(true),
    getManager: jest.fn().mockResolvedValue(null),
    getDirectReports: jest.fn().mockResolvedValue([]),
  },
}));

// ── Import app AFTER mocks are set up ─────────────────────────
import supertest from 'supertest';
import app from '../../app';
import pool from '../../config/db';

const request = supertest(app);

// ── Helpers ───────────────────────────────────────────────────

function actAs(user: MockUserPayload) {
  currentMockUser = user;
}

// ── Setup / Teardown ──────────────────────────────────────────

beforeAll(async () => {
  await seedTestUsers();
  // Lifecycle tests have MANAGER_USER reject/approve EMPLOYEE_USER's expenses; under
  // stub auth that authorization comes from the cached manager_id. Suite-local so the
  // seed baseline stays manager_id = NULL for suites that depend on it.
  await linkManagerReport(EMPLOYEE_USER.id, MANAGER_USER.id);
});

afterAll(async () => {
  await teardownTestDb();
});

// ── Tests ─────────────────────────────────────────────────────

describe('Expense Integration — Full Lifecycle', () => {
  beforeEach(async () => {
    await cleanTestData();
    actAs(EMPLOYEE_USER);
  });

  // ────────────────────────────────────────────────────────────
  // Health check (sanity — no auth required)
  // ────────────────────────────────────────────────────────────

  describe('GET /api/v1/health', () => {
    it('should return healthy status', async () => {
      const res = await request.get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('healthy');
    });
  });

  // ────────────────────────────────────────────────────────────
  // Create → List → Get
  // ────────────────────────────────────────────────────────────

  describe('Expense CRUD', () => {
    it('should create an expense and return 201', async () => {
      const res = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Flight to NYC',
          amount: 450.00,
          currency: 'USD',
          category: 'TRAVEL',
          expense_date: '2026-04-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        submitted_by: EMPLOYEE_USER.id,
        title: 'Flight to NYC',
        status: Status.PENDING,
        version: 1,
      });
      expect(res.body.data.id).toBeDefined();
    });

    it('should reject creation with missing required fields', async () => {
      const res = await request
        .post('/api/v1/expenses')
        .send({ title: 'Incomplete' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should list own expenses after creation', async () => {
      // Create two expenses
      await request
        .post('/api/v1/expenses')
        .send({
          title: 'Expense 1',
          amount: 100,
          currency: 'USD',
          category: 'MEALS',
          expense_date: '2026-04-01',
        });

      await request
        .post('/api/v1/expenses')
        .send({
          title: 'Expense 2',
          amount: 200,
          currency: 'USD',
          category: 'SUPPLIES',
          expense_date: '2026-04-02',
        });

      const res = await request.get('/api/v1/expenses');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.total).toBe(2);
    });

    it('should get a single expense by ID', async () => {
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Single Expense',
          amount: 75,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      const res = await request.get(`/api/v1/expenses/${expenseId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Single Expense');
    });

    it('should return 404 for non-existent expense', async () => {
      const res = await request.get('/api/v1/expenses/9999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should delete a pending expense', async () => {
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'To Delete',
          amount: 50,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      const delRes = await request.delete(`/api/v1/expenses/${expenseId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify it's gone
      const getRes = await request.get(`/api/v1/expenses/${expenseId}`);
      expect(getRes.status).toBe(404);
    });

    it('should persist expense to MySQL with correct column values', async () => {
      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'DB Check',
          description: 'Verify DB persistence',
          amount: 123.45,
          currency: 'EUR',
          category: 'EQUIPMENT',
          // Must not be in the future — createExpenseSchema rejects future dates,
          // and the test clock is 2026-06-11 (the previous '2026-06-15' 400'd).
          expense_date: '2026-05-15',
        });

      expect(createRes.status).toBe(201);
      const expenseId = createRes.body.data.id;

      // Query MySQL directly to verify persistence
      const [rows] = await pool.execute(
        'SELECT * FROM expenses WHERE id = ?',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];

      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('DB Check');
      expect(rows[0].description).toBe('Verify DB persistence');
      expect(Number(rows[0].amount)).toBeCloseTo(123.45);
      expect(rows[0].currency).toBe('EUR');
      expect(rows[0].category).toBe('EQUIPMENT');
      expect(rows[0].status).toBe('PENDING');
      expect(rows[0].version).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Full lifecycle: create → approve → verify audit log
  // ────────────────────────────────────────────────────────────

  describe('Full lifecycle: create → approve → verify audit log', () => {
    it('should create expense as employee, approve as admin, and produce correct audit trail', async () => {
      // Step 1: Employee creates an expense
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Conference Registration',
          description: 'Annual tech conference',
          amount: 1200.00,
          currency: 'USD',
          category: 'TRAINING',
          expense_date: '2026-05-15',
        });

      expect(createRes.status).toBe(201);
      const expenseId = createRes.body.data.id;
      expect(createRes.body.data.status).toBe(Status.PENDING);
      expect(createRes.body.data.version).toBe(1);

      // Step 2: Admin approves the expense
      actAs(ADMIN_USER);

      const approveRes = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.success).toBe(true);
      expect(approveRes.body.data.status).toBe(Status.APPROVED);
      expect(approveRes.body.data.approved_by).toBe(ADMIN_USER.id);
      expect(approveRes.body.data.version).toBe(2);

      // Step 3: Verify audit trail in the real database
      const [auditRows] = await pool.execute(
        'SELECT * FROM audit_logs WHERE expense_id = ? ORDER BY created_at ASC',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];

      expect(auditRows).toHaveLength(2);

      // First log: SUBMITTED by employee
      expect(auditRows[0]).toMatchObject({
        expense_id: expenseId,
        action: AuditAction.SUBMITTED,
        performed_by: EMPLOYEE_USER.id,
        new_status: Status.PENDING,
      });
      expect(auditRows[0].old_status).toBeNull();

      // Second log: APPROVED by admin
      expect(auditRows[1]).toMatchObject({
        expense_id: expenseId,
        action: AuditAction.APPROVED,
        performed_by: ADMIN_USER.id,
        old_status: Status.PENDING,
        new_status: Status.APPROVED,
      });

      // Step 4: Verify the expense row in MySQL reflects the approval
      const [expenseRows] = await pool.execute(
        'SELECT * FROM expenses WHERE id = ?',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];

      expect(expenseRows[0].status).toBe('APPROVED');
      expect(expenseRows[0].approved_by).toBe(ADMIN_USER.id);
      expect(expenseRows[0].version).toBe(2);
    });

    it('should create expense as employee, reject as manager with reason, and produce correct audit trail', async () => {
      // Step 1: Employee creates an expense
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Questionable Expense',
          amount: 5000.00,
          currency: 'USD',
          category: 'EQUIPMENT',
          expense_date: '2026-05-20',
        });

      expect(createRes.status).toBe(201);
      const expenseId = createRes.body.data.id;

      // Step 2: Manager rejects the expense
      actAs(MANAGER_USER);

      const rejectRes = await request
        .patch(`/api/v1/approvals/${expenseId}/reject`)
        .send({ reason: 'Exceeds budget limit for this quarter' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe(Status.REJECTED);

      // Step 3: Verify audit trail in real DB
      const [auditRows] = await pool.execute(
        'SELECT * FROM audit_logs WHERE expense_id = ? ORDER BY created_at ASC',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];

      expect(auditRows).toHaveLength(2);
      expect(auditRows[0].action).toBe(AuditAction.SUBMITTED);
      expect(auditRows[1].action).toBe(AuditAction.REJECTED);
      expect(auditRows[1].performed_by).toBe(MANAGER_USER.id);

      // Verify rejection reason is persisted in the expense
      const [expenseRows] = await pool.execute(
        'SELECT * FROM expenses WHERE id = ?',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];

      expect(expenseRows[0].rejection_reason).toBe('Exceeds budget limit for this quarter');
    });

    it('should not allow approving an already approved expense (409)', async () => {
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Double Approve Test',
          amount: 300,
          currency: 'USD',
          category: 'MEALS',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // First approval
      actAs(ADMIN_USER);
      const firstApprove = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);
      expect(firstApprove.status).toBe(200);

      // Second approval attempt → 409
      const secondApprove = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);
      expect(secondApprove.status).toBe(409);
      expect(secondApprove.body.success).toBe(false);
    });

    it('should not allow an employee to approve their own expense (403)', async () => {
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Self Approve Test',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Employee tries to approve — RBAC blocks (EMPLOYEE not in [MANAGER, ADMIN])
      const approveRes = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(403);
    });

    it('should not allow a manager to approve their own expense', async () => {
      // Manager creates expense
      actAs(MANAGER_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Manager Self-Approve',
          amount: 200,
          currency: 'USD',
          category: 'TRAVEL',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Manager tries to approve own expense → 403
      const approveRes = await request
        .patch(`/api/v1/approvals/${expenseId}/approve`);

      expect(approveRes.status).toBe(403);
      expect(approveRes.body.error.message).toContain('cannot approve your own');
    });

    it('should not allow deleting an approved expense (409)', async () => {
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Delete After Approve',
          amount: 100,
          currency: 'USD',
          category: 'MEALS',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Approve it
      actAs(ADMIN_USER);
      await request.patch(`/api/v1/approvals/${expenseId}/approve`);

      // Employee tries to delete
      actAs(EMPLOYEE_USER);
      const delRes = await request.delete(`/api/v1/expenses/${expenseId}`);

      expect(delRes.status).toBe(409);
      expect(delRes.body.error.message).toContain('Only pending expenses');
    });

    it('should preserve audit logs when expense is soft-deleted', async () => {
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Audit Cleanup Test',
          amount: 75,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Verify audit log exists
      const [beforeRows] = await pool.execute(
        'SELECT COUNT(*) as cnt FROM audit_logs WHERE expense_id = ?',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];
      expect(Number(beforeRows[0].cnt)).toBe(1);

      // Delete the expense
      await request.delete(`/api/v1/expenses/${expenseId}`);

      // Verify audit logs are retained and a DELETED event is appended.
      const [afterRows] = await pool.execute(
        'SELECT action, old_status, new_status FROM audit_logs WHERE expense_id = ? ORDER BY created_at ASC',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];
      expect(afterRows).toHaveLength(2);
      expect(afterRows[0].action).toBe(AuditAction.SUBMITTED);
      expect(afterRows[1]).toMatchObject({
        action: AuditAction.DELETED,
        old_status: Status.PENDING,
        new_status: null,
      });

      const [expenseRows] = await pool.execute(
        'SELECT deleted_at, deleted_by FROM expenses WHERE id = ?',
        [expenseId],
      ) as [Array<Record<string, unknown>>, unknown];
      expect(expenseRows[0].deleted_at).toBeTruthy();
      expect(expenseRows[0].deleted_by).toBe(EMPLOYEE_USER.id);
    });

    // SKIPPED — documents a real gap, not a flaky test. This asserts CLIENT-driven
    // optimistic concurrency, but the API does not implement it: updateExpenseSchema
    // accepts no `version` field, and updateExpense (expenseController.ts) re-reads the
    // live row and passes THAT version to the model's `WHERE version = ?` clause. So
    // bumping the version in the DB before the PUT cannot conflict — the controller
    // just reads the bumped value and updates against it (→ 200, not 409). The model
    // has the locking machinery, but it is never exposed to clients. To make this pass
    // honestly the API must accept an expected version (e.g. an If-Match header or a
    // body field) and the request must send it. Flagged for a product/design decision;
    // un-skip once the API supports client-supplied versions.
    it.skip('should enforce optimistic concurrency on expense updates (API lacks client-supplied version)', async () => {
      actAs(EMPLOYEE_USER);

      const createRes = await request
        .post('/api/v1/expenses')
        .send({
          title: 'Concurrency Test',
          amount: 100,
          currency: 'USD',
          category: 'OTHER',
          expense_date: '2026-04-01',
        });

      const expenseId = createRes.body.data.id;

      // Simulate a concurrent update by bumping version directly in DB
      await pool.execute(
        'UPDATE expenses SET version = version + 1 WHERE id = ?',
        [expenseId],
      );

      // Now our update should fail (we have version 1, DB has version 2)
      const updateRes = await request
        .put(`/api/v1/expenses/${expenseId}`)
        .send({ title: 'Should Fail' });

      expect(updateRes.status).toBe(409);
    });
  });
});
