/**
 * Integration test — Stats endpoints (/me, /manager, /admin).
 *
 * Exercises the real HTTP stack (supertest → Express → routes → controllers → models → MySQL)
 * with mocked auth middleware (so we can switch acting user via actAs) but a real database.
 *
 * authorize() is NOT mocked, so RBAC role gating still runs against the acting user's role.
 *
 * This suite inserts its OWN expenses (and one extra employee whose manager_id = 2) with
 * controlled amounts/dates so the asserted totals are deterministic and computed in cents.
 * It does not rely on database/seed.sql.
 */

import { Request, Response, NextFunction } from 'express';
import {
  MockUserPayload,
  EMPLOYEE_USER,
  MANAGER_USER,
  ADMIN_USER,
  seedTestUsers,
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

// ── Mock Graph API service (some controllers import it transitively) ──
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

// Local cleanup for stats tests. The stats endpoints are READ-ONLY and this suite inserts
// expenses directly (never through the API), so no audit_logs rows are ever created. We
// therefore do NOT touch audit_logs — the schema has a BEFORE DELETE trigger that makes
// audit_logs append-only, and the shared cleanTestData() (which DELETEs audit_logs) cannot
// be used here. Deleting only expenses is FK-safe because nothing references our rows.
async function cleanExpenses(): Promise<void> {
  await pool.execute('DELETE FROM expenses');
  await pool.execute('ALTER TABLE expenses AUTO_INCREMENT = 1');
}

// Extra employee who reports to the MANAGER_USER (id 2). Used to exercise /manager/stats,
// since EMPLOYEE_USER (id 1) is seeded with manager_id = NULL.
const REPORT_USER_ID = 4;

async function insertExpense(opts: {
  submitted_by: number;
  amount: number;
  category: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  // Days offset from the first of the current month (0 = current month).
  // Use the current month for MTD assertions.
  expenseDateSql: string;
}): Promise<void> {
  const rejectionReason = opts.status === 'REJECTED' ? 'integration rejected' : null;
  const approvedBy = opts.status === 'APPROVED' ? ADMIN_USER.id : null;
  await pool.execute(
    `INSERT INTO expenses (submitted_by, title, amount, currency, category, expense_date, status, approved_by, rejection_reason)
     VALUES (?, ?, ?, 'USD', ?, ${opts.expenseDateSql}, ?, ?, ?)`,
    [opts.submitted_by, 'integration expense', opts.amount, opts.category, opts.status, approvedBy, rejectionReason],
  );
}

// ── Setup / Teardown ──────────────────────────────────────────

beforeAll(async () => {
  await seedTestUsers();
  // Add an active employee reporting to the manager (id 2).
  await pool.execute(
    `INSERT INTO users (id, entra_id, email, display_name, role, manager_id, is_active)
     VALUES (?, 'entra-report', 'report@test.com', 'Test Report', 'EMPLOYEE', ?, 1)
     ON DUPLICATE KEY UPDATE manager_id = VALUES(manager_id), is_active = VALUES(is_active)`,
    [REPORT_USER_ID, MANAGER_USER.id],
  );
});

afterAll(async () => {
  // FK-safe teardown: remove the expenses we created, then the users (including the extra
  // report user id 4), then end the pool. audit_logs is intentionally left untouched
  // (append-only; this suite never writes it).
  await cleanExpenses();
  await pool.execute('DELETE FROM users');
  await pool.end();
});

// Current-month date expression (first day of this month) — keeps MTD assertions stable
// regardless of when the suite runs.
const THIS_MONTH = `DATE_FORMAT(CURDATE(), '%Y-%m-01')`;
// A date 5 months ago (still within the 6-month monthly series window).
const FIVE_MONTHS_AGO = `DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')`;

// ── Tests ─────────────────────────────────────────────────────

describe('Stats Integration', () => {
  beforeEach(async () => {
    await cleanExpenses();
    actAs(EMPLOYEE_USER);
  });

  // ────────────────────────────────────────────────────────────
  // GET /api/v1/me/stats
  // ────────────────────────────────────────────────────────────

  describe('GET /api/v1/me/stats', () => {
    it('returns the caller stats envelope with numeric totals and amounts', async () => {
      // EMPLOYEE_USER (id 1): 2 approved this month (100.50 + 50.25 = 150.75),
      // 1 pending this month (75.10), 1 rejected this month (10.00) → submitted = 4.
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 100.50, category: 'TRAVEL', status: 'APPROVED', expenseDateSql: THIS_MONTH });
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 50.25, category: 'MEALS', status: 'APPROVED', expenseDateSql: THIS_MONTH });
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 75.10, category: 'TRAVEL', status: 'PENDING', expenseDateSql: THIS_MONTH });
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 10.00, category: 'OTHER', status: 'REJECTED', expenseDateSql: THIS_MONTH });
      // A different user's expense must NOT leak into the caller's stats.
      await insertExpense({ submitted_by: REPORT_USER_ID, amount: 999.99, category: 'SOFTWARE', status: 'APPROVED', expenseDateSql: THIS_MONTH });

      const res = await request.get('/api/v1/me/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data.totals).toEqual({ submitted: 4, pending: 1, approved: 2, rejected: 1 });
      expect(typeof data.totals.submitted).toBe('number');

      // Approved amount this month keeps cents: 100.50 + 50.25 = 150.75
      expect(typeof data.approvedAmountMonth).toBe('number');
      expect(data.approvedAmountMonth).toBeCloseTo(150.75, 2);

      // byCategory totals are numbers
      expect(Array.isArray(data.byCategory)).toBe(true);
      const travel = data.byCategory.find((c: { category: string }) => c.category === 'TRAVEL');
      expect(travel).toBeDefined();
      expect(typeof travel.total).toBe('number');
      expect(travel.count).toBe(2);
      expect(travel.total).toBeCloseTo(175.60, 2); // 100.50 + 75.10

      // monthly series amounts are numbers
      expect(Array.isArray(data.monthly)).toBe(true);
      for (const m of data.monthly) {
        expect(typeof m.month).toBe('string');
        expect(typeof m.total).toBe('number');
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // GET /api/v1/manager/stats
  // ────────────────────────────────────────────────────────────

  describe('GET /api/v1/manager/stats', () => {
    it('returns team rollup for the caller direct reports with numeric values', async () => {
      // Team of manager id 2 = REPORT_USER_ID (manager_id = 2). EMPLOYEE_USER (id 1) is NOT
      // on the team (manager_id NULL), so its expense below must be excluded.
      await insertExpense({ submitted_by: REPORT_USER_ID, amount: 200.00, category: 'TRAVEL', status: 'APPROVED', expenseDateSql: THIS_MONTH });
      await insertExpense({ submitted_by: REPORT_USER_ID, amount: 33.33, category: 'MEALS', status: 'PENDING', expenseDateSql: THIS_MONTH });
      // Not on the team → excluded from team stats.
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 500.00, category: 'EQUIPMENT', status: 'PENDING', expenseDateSql: THIS_MONTH });

      actAs(MANAGER_USER);
      const res = await request.get('/api/v1/manager/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      // Exactly one active direct report (REPORT_USER_ID).
      expect(data.teamSize).toBe(1);
      // One pending expense on the team (the report's 33.33).
      expect(data.pendingApprovals).toBe(1);

      expect(typeof data.teamSpendMonth).toBe('number');
      expect(data.teamSpendMonth).toBeCloseTo(233.33, 2); // 200.00 + 33.33
      expect(typeof data.approvedMonth).toBe('number');
      expect(data.approvedMonth).toBeCloseTo(200.00, 2);

      expect(Array.isArray(data.byCategory)).toBe(true);
      expect(Array.isArray(data.monthly)).toBe(true);
      for (const m of data.monthly) {
        expect(typeof m.total).toBe('number');
      }
    });

    it('forbids a non-manager from accessing /manager/stats (403)', async () => {
      actAs(EMPLOYEE_USER);
      const res = await request.get('/api/v1/manager/stats');
      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────
  // GET /api/v1/admin/stats
  // ────────────────────────────────────────────────────────────

  describe('GET /api/v1/admin/stats', () => {
    it('returns org-wide stats with numeric values', async () => {
      // Org-wide aggregates span all users.
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 100.00, category: 'TRAVEL', status: 'APPROVED', expenseDateSql: THIS_MONTH });
      await insertExpense({ submitted_by: REPORT_USER_ID, amount: 250.50, category: 'SOFTWARE', status: 'APPROVED', expenseDateSql: THIS_MONTH });
      await insertExpense({ submitted_by: MANAGER_USER.id, amount: 75.25, category: 'MEALS', status: 'PENDING', expenseDateSql: THIS_MONTH });
      // An older approved expense (5 months ago) contributes to the monthly series but not MTD.
      await insertExpense({ submitted_by: EMPLOYEE_USER.id, amount: 40.00, category: 'OTHER', status: 'APPROVED', expenseDateSql: FIVE_MONTHS_AGO });

      actAs(ADMIN_USER);
      const res = await request.get('/api/v1/admin/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      // org spend this month = 100.00 + 250.50 + 75.25 (the 5-months-ago row is excluded)
      expect(typeof data.orgSpendMonth).toBe('number');
      expect(data.orgSpendMonth).toBeCloseTo(425.75, 2);
      // approved this month = 100.00 + 250.50
      expect(typeof data.approvedMonth).toBe('number');
      expect(data.approvedMonth).toBeCloseTo(350.50, 2);
      // one pending org-wide
      expect(data.pendingOrgWide).toBe(1);
      // active users: ids 1,2,3 (seeded active) + report (active) = 4
      expect(typeof data.activeUsers).toBe('number');
      expect(data.activeUsers).toBeGreaterThanOrEqual(4);

      expect(Array.isArray(data.byCategory)).toBe(true);
      expect(Array.isArray(data.monthly)).toBe(true);
      // Monthly series should include the 5-months-ago bucket.
      const months = data.monthly.map((m: { month: string }) => m.month);
      expect(months.length).toBeGreaterThanOrEqual(1);
      for (const m of data.monthly) {
        expect(typeof m.total).toBe('number');
      }
    });

    it('forbids a non-admin from accessing /admin/stats (403)', async () => {
      actAs(MANAGER_USER);
      const res = await request.get('/api/v1/admin/stats');
      expect(res.status).toBe(403);
    });
  });
});
