import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import logger from '../config/logger';
import { Role } from '../types';
import {
  getDemoSecret,
  getDemoTtlSeconds,
  getDemoMaxActive,
} from '../config/demo';

export interface DemoWorkspace {
  sessionId: string;
  expiresAt: Date;
  // userId for each role the visitor may log in as (the role picker on the
  // login page). EMPLOYEE resolves to the first seeded report (Jordan Lee).
  usersByRole: Record<Role, number>;
}

interface SeedExpense {
  submittedBy: number;
  title: string;
  description: string;
  amount: number;
  category: 'TRAVEL' | 'MEALS' | 'SUPPLIES' | 'EQUIPMENT' | 'SOFTWARE' | 'TRAINING' | 'OTHER';
  daysAgo: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
}

async function insertDemoUser(
  conn: PoolConnection,
  params: {
    displayName: string;
    emailLocal: string;
    role: Role;
    managerId: number | null;
    jobTitle: string | null;
    department: string | null;
    officeLocation: string | null;
    employeeId: string | null;
    sessionId: string;
    ttlSeconds: number;
  },
): Promise<number> {
  const entraId = randomUUID(); // 36 chars — fits users.entra_id and is globally unique
  // Use the FULL session id (not a 6-char slice) so the address is globally
  // unique: emailLocal is unique per role and sessionId is unique per workspace,
  // so the pair can never collide against the uk_email UNIQUE key. A short slice
  // risked a birthday collision as the live+unreaped demo-user population grew,
  // which would fail the INSERT and 500 the visitor.
  const email = `${params.emailLocal}.${params.sessionId}@demo.local`;
  const [result] = await conn.execute<ResultSetHeader>(
    `INSERT INTO users
       (entra_id, email, display_name, role, manager_id, job_title, department, office_location, employee_id, is_demo, demo_expires_at, demo_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)`,
    [entraId, email, params.displayName, params.role, params.managerId, params.jobTitle, params.department, params.officeLocation, params.employeeId, params.ttlSeconds, params.sessionId],
  );
  return result.insertId;
}

async function insertDemoExpense(conn: PoolConnection, seed: SeedExpense, managerId: number): Promise<void> {
  const isResolved = seed.status !== 'PENDING';
  const [result] = await conn.execute<ResultSetHeader>(
    `INSERT INTO expenses
       (submitted_by, title, description, amount, currency, category, expense_date, status, approved_by, rejection_reason, version)
     VALUES (?, ?, ?, ?, 'USD', ?, DATE_SUB(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?)`,
    [
      seed.submittedBy,
      seed.title,
      seed.description,
      seed.amount,
      seed.category,
      seed.daysAgo,
      seed.status,
      isResolved ? managerId : null,
      seed.status === 'REJECTED' ? seed.rejectionReason ?? 'Does not meet policy' : null,
      isResolved ? 2 : 1,
    ],
  );
  const expenseId = result.insertId;

  // SUBMITTED audit row mirrors the real submit flow (sp_submit_expense).
  await conn.execute<ResultSetHeader>(
    `INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
     VALUES (?, 'SUBMITTED', ?, NULL, 'PENDING', NULL, NULL)`,
    [expenseId, seed.submittedBy],
  );

  if (seed.status === 'APPROVED') {
    await conn.execute<ResultSetHeader>(
      `INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
       VALUES (?, 'APPROVED', ?, 'PENDING', 'APPROVED', ?, NULL)`,
      [expenseId, managerId, JSON.stringify({ version_before: 1, version_after: 2 })],
    );
  } else if (seed.status === 'REJECTED') {
    await conn.execute<ResultSetHeader>(
      `INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
       VALUES (?, 'REJECTED', ?, 'PENDING', 'REJECTED', ?, NULL)`,
      [
        expenseId,
        managerId,
        JSON.stringify({ rejection_reason: seed.rejectionReason ?? 'Does not meet policy', version_before: 1, version_after: 2 }),
      ],
    );
  }
}

function buildSeedExpenses(managerId: number, emp1Id: number, emp2Id: number): SeedExpense[] {
  return [
    // The visitor's own submissions — visible under "My Expenses", both pending.
    { submittedBy: managerId, title: 'Flight to Chicago — client kickoff', description: 'Round-trip economy', amount: 380.0, category: 'TRAVEL', daysAgo: 2, status: 'PENDING' },
    { submittedBy: managerId, title: 'Client dinner', description: 'Dinner with the Acme team', amount: 92.4, category: 'MEALS', daysAgo: 1, status: 'PENDING' },
    // Employee 1 (Jordan) — populates the approval queue plus history.
    { submittedBy: emp1Id, title: 'Mechanical keyboard', description: 'Home-office setup', amount: 119.99, category: 'EQUIPMENT', daysAgo: 1, status: 'PENDING' },
    { submittedBy: emp1Id, title: 'AWS Solutions Architect course', description: 'Certification prep', amount: 300.0, category: 'TRAINING', daysAgo: 6, status: 'APPROVED' },
    { submittedBy: emp1Id, title: 'Noise-cancelling headphones', description: 'Open-plan office', amount: 249.0, category: 'EQUIPMENT', daysAgo: 8, status: 'REJECTED', rejectionReason: 'Equipment over $200 needs prior IT approval' },
    // Employee 2 (Sam).
    { submittedBy: emp2Id, title: 'Office supplies', description: 'Notebooks and pens', amount: 38.75, category: 'SUPPLIES', daysAgo: 0, status: 'PENDING' },
    { submittedBy: emp2Id, title: 'JetBrains IDE license', description: 'Annual subscription', amount: 169.0, category: 'SOFTWARE', daysAgo: 4, status: 'APPROVED' },
  ];
}

/**
 * Create a fresh, fully isolated demo workspace: a small but multi-level org — an
 * admin over an Engineering and a Sales branch (nine users, deep enough to show
 * reports-of-reports in the org chart) — plus a realistic spread of seeded
 * expenses for the manager persona's own team. Every user is tied by the same
 * demo_session_id, flagged is_demo and stamped with an expiry, then reaped after
 * the TTL.
 *
 * Returns the per-role user ids so the caller can mint a demo session token for
 * whichever role the visitor picked on the login page (EMPLOYEE resolves to
 * Jordan Lee, one of the manager's direct reports).
 */
export async function createDemoWorkspace(): Promise<DemoWorkspace> {
  const sessionId = randomUUID();
  const ttlSeconds = getDemoTtlSeconds();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // One helper so every seeded row inherits this workspace's sessionId + TTL and
    // a sequential employee id (E-0001…), giving the org-chart detail modal
    // populated office/employee-id fields even in the demo (no live Graph there).
    let empSeq = 0;
    const seed = (u: {
      displayName: string;
      emailLocal: string;
      role: Role;
      managerId: number | null;
      jobTitle: string;
      department: string;
      officeLocation: string;
    }) =>
      insertDemoUser(conn, {
        ...u,
        employeeId: `E-${String(++empSeq).padStart(4, '0')}`,
        sessionId,
        ttlSeconds,
      });

    // Head of the org.
    const adminId = await seed({
      displayName: 'Demo Admin', emailLocal: 'demo.admin', role: Role.ADMIN,
      managerId: null, jobTitle: 'Chief Executive Officer', department: 'Executive',
      officeLocation: 'San Francisco (HQ)',
    });

    // Engineering branch. Demo User is the MANAGER login persona; Jordan Lee and
    // Sam Carter are the DIRECT reports whose expenses fill the approval queue.
    // Ravi (a lead) with Ana under him add a reports-of-reports level.
    const managerId = await seed({
      displayName: 'Demo User', emailLocal: 'demo.user', role: Role.MANAGER,
      managerId: adminId, jobTitle: 'Engineering Manager', department: 'Engineering',
      officeLocation: 'San Francisco',
    });
    const emp1Id = await seed({
      displayName: 'Jordan Lee', emailLocal: 'jordan.lee', role: Role.EMPLOYEE,
      managerId, jobTitle: 'Software Engineer', department: 'Engineering',
      officeLocation: 'San Francisco',
    });
    const emp2Id = await seed({
      displayName: 'Sam Carter', emailLocal: 'sam.carter', role: Role.EMPLOYEE,
      managerId, jobTitle: 'Software Engineer', department: 'Engineering',
      officeLocation: 'Remote',
    });
    const leadId = await seed({
      displayName: 'Ravi Shah', emailLocal: 'ravi.shah', role: Role.MANAGER,
      managerId, jobTitle: 'Engineering Lead', department: 'Engineering',
      officeLocation: 'Austin',
    });
    await seed({
      displayName: 'Ana Torres', emailLocal: 'ana.torres', role: Role.EMPLOYEE,
      managerId: leadId, jobTitle: 'Product Designer', department: 'Engineering',
      officeLocation: 'Austin',
    });

    // Sales branch — a second department and depth, so the ADMIN org chart shows a
    // real multi-team tree rather than a single line.
    const salesManagerId = await seed({
      displayName: 'Priya Nair', emailLocal: 'priya.nair', role: Role.MANAGER,
      managerId: adminId, jobTitle: 'Head of Sales', department: 'Sales',
      officeLocation: 'New York',
    });
    await seed({
      displayName: 'Diego Alvarez', emailLocal: 'diego.alvarez', role: Role.EMPLOYEE,
      managerId: salesManagerId, jobTitle: 'Account Executive', department: 'Sales',
      officeLocation: 'New York',
    });
    await seed({
      displayName: 'Mei Lin', emailLocal: 'mei.lin', role: Role.EMPLOYEE,
      managerId: salesManagerId, jobTitle: 'Account Executive', department: 'Sales',
      officeLocation: 'Chicago',
    });

    for (const expense of buildSeedExpenses(managerId, emp1Id, emp2Id)) {
      await insertDemoExpense(conn, expense, managerId);
    }

    await conn.commit();

    logger.info('Created demo workspace', { sessionId, adminId, managerId });
    return {
      sessionId,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      usersByRole: {
        [Role.ADMIN]: adminId,
        [Role.MANAGER]: managerId,
        [Role.EMPLOYEE]: emp1Id,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Count live (non-expired) demo workspaces, for the DEMO_MAX_ACTIVE cap. */
export async function countActiveDemoSessions(): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT demo_session_id) AS count
       FROM users
      WHERE is_demo = TRUE AND demo_expires_at > NOW()`,
  );
  return Number((rows[0] as { count: number }).count) || 0;
}

/** True when a new demo workspace can be created without exceeding the cap. */
export async function canCreateDemoWorkspace(): Promise<boolean> {
  return (await countActiveDemoSessions()) < getDemoMaxActive();
}

/** Mint a short-lived, HS256-signed demo session token (separate from Entra RS256). */
export function signDemoToken(userId: number, role: Role): string {
  const secret = getDemoSecret();
  if (!secret) {
    throw new Error('DEMO_JWT_SECRET is not configured');
  }
  return jwt.sign({ sub: String(userId), demo: true, role }, secret, {
    algorithm: 'HS256',
    expiresIn: getDemoTtlSeconds(),
  });
}

/**
 * Delete expired demo workspaces. FK order matters: audit_logs first (the
 * demo-aware delete trigger permits rows whose performer is a demo user), then
 * expenses (RESTRICT from audit cleared; receipts/comments/notifications cascade
 * on the expense), then security_events for those demo users (FK is SET NULL so
 * it wouldn't block, but clearing them prevents orphaned rows accumulating),
 * then the demo users themselves (their remaining child rows cascade).
 *
 * The batch is bounded by whole WORKSPACES, not raw user rows: we pick up to 200
 * expired demo_session_ids and delete every user of those sessions together. A
 * per-user LIMIT could split a workspace across the batch boundary — leaving an
 * approver's APPROVED/REJECTED audit row (performer not in the batch) still
 * pointing at an expense we try to delete, which the audit_logs→expenses RESTRICT
 * would reject, rolling back the whole tick and wedging the reaper as the backlog
 * grows. Selecting entire sessions makes that split impossible.
 */
export async function reapExpiredDemoWorkspaces(): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM users
        WHERE is_demo = TRUE
          AND demo_session_id IN (
            SELECT demo_session_id FROM (
              SELECT DISTINCT demo_session_id
                FROM users
               WHERE is_demo = TRUE
                 AND demo_expires_at < NOW()
                 AND demo_session_id IS NOT NULL
               LIMIT 200
            ) AS expired_sessions
          )`,
    );
    const ids = rows.map((r) => (r as { id: number }).id);
    if (ids.length === 0) {
      await conn.commit();
      return 0;
    }

    const placeholders = ids.map(() => '?').join(', ');
    await conn.query(`DELETE FROM audit_logs WHERE performed_by IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM expenses WHERE submitted_by IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM security_events WHERE user_id IN (${placeholders})`, ids);
    await conn.query(`DELETE FROM users WHERE id IN (${placeholders})`, ids);

    await conn.commit();
    return ids.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Start the periodic demo reaper. Returns a stop function for graceful shutdown. */
export function startDemoCleanup(intervalMs = 15 * 60 * 1000): () => void {
  const tick = (): void => {
    reapExpiredDemoWorkspaces()
      .then((count) => {
        if (count > 0) logger.info('Demo cleanup: reaped expired demo users', { count });
      })
      .catch((err) => {
        logger.error('Demo cleanup failed', { err: err instanceof Error ? err.message : String(err) });
      });
  };

  // Reap once immediately. setInterval fires the first tick only after a full
  // interval, and the deployment is scale-to-zero, so the container can be killed
  // before it stays up 15 min — without an eager tick a cold start would never
  // reap and expired rows would accumulate. Also clears any boot-time backlog.
  tick();

  // Local (not module-level) so repeated calls each own their timer instead of
  // leaking the previous interval.
  const timer = setInterval(tick, intervalMs);
  timer.unref(); // never keep the process alive for the reaper alone
  logger.info('Demo cleanup scheduled', { intervalMs });

  return () => {
    clearInterval(timer); // idempotent — a second call is a harmless no-op
  };
}
