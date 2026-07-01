/**
 * Integration test — Public demo-sandbox isolation (the app's headline
 * public-facing risk).
 *
 * Uses the REAL auth stack via the demo path (NOT a mocked authenticate): we
 * mint a genuine demo session token through POST /auth/demo-login and drive
 * every request with it. This proves end-to-end that a public demo ADMIN:
 *   - only ever sees its own demo workspace (never real users/expenses),
 *   - cannot inherit the blanket-admin bypass to read a real expense by id,
 *   - is fenced out of every bulk CSV export (denyDemo).
 */

import pool from '../../config/db';
import {
  EMPLOYEE_USER,
  seedTestUsers,
  teardownTestDb,
} from './setup';

// Graph API is never hit on a demo path, but stub it so importing app has no
// external side effects (mirrors the auth suite).
jest.mock('../../services/graphApi', () => ({
  graphApiService: {
    isManagerOf: jest.fn().mockResolvedValue(true),
    getManager: jest.fn().mockResolvedValue(null),
    getDirectReports: jest.fn().mockResolvedValue([]),
  },
  isGraphApiAuthError: () => false,
}));

// ── Import app AFTER mocks. authenticate is REAL here. ────────
import supertest from 'supertest';
import app from '../../app';

const request = supertest(app);

// The demo path is gated on these env vars, read at request time in
// routes/auth.ts. Set them here so the suite is self-contained and passes under
// any runner — the CI docker-compose test-runner does not export them.
process.env.ENABLE_DEMO = 'true';
process.env.DEMO_JWT_SECRET = process.env.DEMO_JWT_SECRET ?? 'integration-demo-secret';

// A real (non-demo) expense owned by a real user. Its title is our canary: it
// must NEVER appear in any demo-scoped response.
const REAL_EXPENSE_TITLE = 'REAL-USER-CONFIDENTIAL-EXPENSE';
// One of the seeded demo expenses (submitted by the demo manager).
const DEMO_EXPENSE_TITLE = 'Flight to Chicago — client kickoff';

let realExpenseId = 0;
let demoAdminToken = '';

function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

beforeAll(async () => {
  await seedTestUsers();

  // A real expense owned by the seeded real EMPLOYEE_USER (is_demo defaults FALSE).
  const [result] = await pool.execute(
    `INSERT INTO expenses
       (submitted_by, title, description, amount, currency, category, expense_date, status, version)
     VALUES (?, ?, ?, ?, 'USD', 'OTHER', CURDATE(), 'PENDING', 1)`,
    [EMPLOYEE_USER.id, REAL_EXPENSE_TITLE, 'confidential real data', 42.0],
  );
  realExpenseId = (result as { insertId: number }).insertId;

  // Mint a genuine public demo ADMIN session via the real route.
  const res = await request.post('/api/v1/auth/demo-login').send({ role: 'ADMIN' });
  expect(res.status).toBe(201);
  demoAdminToken = res.body.data.token as string;
  expect(typeof demoAdminToken).toBe('string');
  expect(demoAdminToken.length).toBeGreaterThan(10);
});

afterAll(async () => {
  await teardownTestDb();
});

describe('Public demo-sandbox isolation', () => {
  describe('Read-only admin views are scoped to the demo workspace only', () => {
    it('GET /admin/expenses returns ONLY demo-workspace rows, never the real expense', async () => {
      const res = await request.get('/api/v1/admin/expenses').set(...bearer(demoAdminToken));

      expect(res.status).toBe(200);
      const titles = (res.body.data as Array<{ title: string }>).map((e) => e.title);
      // The seeded demo workspace is present…
      expect(titles).toContain(DEMO_EXPENSE_TITLE);
      // …but the real user's expense is NOT.
      expect(titles).not.toContain(REAL_EXPENSE_TITLE);
    });

    it('GET /admin/users returns ONLY demo-workspace users, never the real user', async () => {
      const res = await request.get('/api/v1/admin/users').set(...bearer(demoAdminToken));

      expect(res.status).toBe(200);
      const emails = (res.body.data as Array<{ email: string }>).map((u) => u.email);
      const names = (res.body.data as Array<{ display_name: string }>).map((u) => u.display_name);
      // Real user leak check.
      expect(emails).not.toContain(EMPLOYEE_USER.email);
      // Demo workspace users are present.
      expect(names).toContain('Jordan Lee');
      expect(names).toContain('Demo Admin');
      // Every returned user is a demo-workspace address.
      for (const email of emails) {
        expect(email.endsWith('@demo.local')).toBe(true);
      }
    });
  });

  describe('A demo session cannot cross into real data', () => {
    it('GET /expenses/{realExpenseId} → 403 (no blanket-admin bypass for a demo admin)', async () => {
      const res = await request
        .get(`/api/v1/expenses/${realExpenseId}`)
        .set(...bearer(demoAdminToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Bulk exports are fenced off for demo sessions (denyDemo)', () => {
    it('GET /admin/expenses/export → 403', async () => {
      const res = await request
        .get('/api/v1/admin/expenses/export')
        .set(...bearer(demoAdminToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('GET /admin/audit-logs/export → 403', async () => {
      const res = await request
        .get('/api/v1/admin/audit-logs/export')
        .set(...bearer(demoAdminToken));

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
