/**
 * Integration test helpers.
 *
 * These tests exercise the full HTTP stack (routes → middleware → controllers → models → MySQL)
 * with mocked auth (Entra ID) and Graph API, but everything else is real —
 * validation, RBAC, error handling, models, and database queries all hit a live MySQL instance.
 *
 * Requires a running MySQL instance with the schema loaded (via docker-compose.test.yml
 * or a local DB pointed to by DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME env vars).
 */

import pool from '../../config/db';
import { Role } from '../../types';

// ── Auth bypass ──────────────────────────────────────────────
// We mock the `authenticate` middleware so it injects req.user
// without contacting Entra ID or JWKS.

export interface MockUserPayload {
  id: number;
  role: Role;
  email: string;
  display_name: string;
  // These integration tests run with stub auth (NODE_ENV=test, no real Entra token),
  // which is exactly how the app runs in dev/CI. The real authenticate middleware sets
  // req.user.stubAuth = true in that mode; verifyManagerRelationship relies on it to
  // trust the cached manager_id (it has no Bearer token to call Graph with). The mock
  // must reproduce that flag or every manager-authorization check 403s.
  stubAuth: boolean;
}

/**
 * Create a standard mock user payload for injecting into req.user.
 */
export function mockUserPayload(overrides: Partial<MockUserPayload> = {}): MockUserPayload {
  return {
    id: 1,
    role: Role.EMPLOYEE,
    email: 'employee@test.com',
    display_name: 'Test Employee',
    stubAuth: true,
    ...overrides,
  };
}

export const EMPLOYEE_USER = mockUserPayload();

export const MANAGER_USER = mockUserPayload({
  id: 2,
  role: Role.MANAGER,
  email: 'manager@test.com',
  display_name: 'Test Manager',
});

export const ADMIN_USER = mockUserPayload({
  id: 3,
  role: Role.ADMIN,
  email: 'admin@test.com',
  display_name: 'Test Admin',
});

// ── Database helpers ─────────────────────────────────────────

/**
 * Seed the test users that match our mock payloads.
 * Called once before each test suite.
 */
export async function seedTestUsers(): Promise<void> {
  await pool.execute(
    `INSERT INTO users (id, entra_id, email, display_name, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), manager_id = NULL`,
    [EMPLOYEE_USER.id, 'entra-employee', EMPLOYEE_USER.email, EMPLOYEE_USER.display_name, EMPLOYEE_USER.role, true],
  );

  await pool.execute(
    `INSERT INTO users (id, entra_id, email, display_name, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), manager_id = NULL`,
    [MANAGER_USER.id, 'entra-manager', MANAGER_USER.email, MANAGER_USER.display_name, MANAGER_USER.role, true],
  );

  await pool.execute(
    `INSERT INTO users (id, entra_id, email, display_name, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), manager_id = NULL`,
    [ADMIN_USER.id, 'entra-admin', ADMIN_USER.email, ADMIN_USER.display_name, ADMIN_USER.role, true],
  );
}

/**
 * Establish a reporting line (report → manager). manager_id is a self-FK, so the
 * manager row must already exist (seedTestUsers runs first). Suites that exercise
 * manager-authorization opt into this explicitly; the seed baseline leaves everyone
 * with manager_id = NULL so suites that depend on "no manager" (e.g. stats team
 * rollup) are not affected by execution order.
 */
export async function linkManagerReport(reportUserId: number, managerUserId: number): Promise<void> {
  await pool.execute('UPDATE users SET manager_id = ? WHERE id = ?', [managerUserId, reportUserId]);
}

/**
 * Clean all test data from transactional tables (audit_logs, expenses).
 * Users are left in place since they're re-used across tests.
 */
export async function cleanTestData(): Promise<void> {
  // audit_logs is append-only: a BEFORE DELETE trigger raises SQLSTATE 45000, so a
  // plain DELETE fails once any rows exist. TRUNCATE does not fire row-level triggers
  // and also resets AUTO_INCREMENT. It must run before expenses because
  // audit_logs.expense_id is ON DELETE RESTRICT; nothing references audit_logs, so
  // TRUNCATE is permitted even while expenses still has rows.
  await pool.execute('TRUNCATE TABLE audit_logs');
  // receipts/comments/notifications are ON DELETE CASCADE from expenses, but clear them
  // explicitly for determinism before removing expenses.
  await pool.execute('DELETE FROM receipts');
  await pool.execute('DELETE FROM comments');
  await pool.execute('DELETE FROM notifications');
  await pool.execute('DELETE FROM expenses');
  // Reset auto-increment so IDs are predictable
  await pool.execute('ALTER TABLE expenses AUTO_INCREMENT = 1');
}

/**
 * Tear down: clean everything and end the pool.
 */
export async function teardownTestDb(): Promise<void> {
  // pool.end() MUST run even if a cleanup statement throws — otherwise the
  // connection pool leaks and (now that --forceExit is gone) the run hangs.
  try {
    // See cleanTestData for why audit_logs is truncated rather than deleted.
    await pool.execute('TRUNCATE TABLE audit_logs');

    // FOREIGN_KEY_CHECKS is a per-connection (session) variable, so the disable
    // and the DELETEs it protects MUST run on the same connection. Issuing them as
    // separate pool.execute() calls can land them on different pooled connections,
    // leaving the DELETEs — including the self-referential users.manager_id FK —
    // running with checks still on and able to raise a RESTRICT error. Pin one
    // connection for the whole sequence and release it before ending the pool.
    const conn = await pool.getConnection();
    try {
      await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
      await conn.execute('DELETE FROM receipts');
      await conn.execute('DELETE FROM comments');
      await conn.execute('DELETE FROM notifications');
      await conn.execute('DELETE FROM expenses');
      await conn.execute('DELETE FROM users');
      await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
  } finally {
    await pool.end();
  }
}
