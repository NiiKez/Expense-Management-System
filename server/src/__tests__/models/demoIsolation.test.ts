import pool from '../../config/db';
import { expenseModel } from '../../models/expense';
import { userModel } from '../../models/user';
import { auditLogModel } from '../../models/auditLog';
import { statsModel } from '../../models/stats';

// Every admin / org-wide query must be demo-aware in BOTH directions:
//  - a REAL admin (no demoSessionId) sees only real rows (is_demo = FALSE), so
//    live demo-sandbox data never pollutes the owner's dashboard, lists, exports
//    or aggregates.
//  - a DEMO admin (demoSessionId set) sees only its own workspace
//    (is_demo = TRUE AND demo_session_id = ?), never real or other workspaces'.
// These tests pin the generated SQL so a regression that drops either half is
// caught immediately.

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/cacheService', () => ({
  __esModule: true,
  cacheService: { invalidateUser: jest.fn(), get: jest.fn(), set: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };
const SESSION = 'demo-session-abc';

// A single row shape that satisfies every scalar/list destructure across the
// models under test (count/total/c/t + generic list rows).
const ROW = { total: 0, count: 0, c: 0, t: 0, id: 1, category: 'TRAVEL', month: '2026-01' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedPool.execute.mockResolvedValue([[ROW]]);
  mockedPool.query.mockResolvedValue([[ROW]]);
});

/** All SQL text issued during the call, from both execute() and query(). */
function allSql(): string {
  return [...mockedPool.execute.mock.calls, ...mockedPool.query.mock.calls]
    .map((c) => String(c[0]))
    .join('\n---\n');
}

/** Every bound-parameter value passed during the call, flattened. */
function allParams(): unknown[] {
  return [...mockedPool.execute.mock.calls, ...mockedPool.query.mock.calls].flatMap((c) => c[1] ?? []);
}

describe('expenseModel.findAll demo isolation', () => {
  it('excludes demo rows for a real admin (no session)', async () => {
    await expenseModel.findAll({});
    expect(allSql()).toContain('u.is_demo = FALSE');
    expect(allSql()).not.toContain('u.is_demo = TRUE');
  });

  it('scopes to one workspace for a demo admin', async () => {
    await expenseModel.findAll({ demoSessionId: SESSION });
    const sql = allSql();
    expect(sql).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(sql).not.toContain('u.is_demo = FALSE');
    expect(allParams()).toContain(SESSION);
  });
});

describe('expenseModel.findAllForExport demo isolation', () => {
  it('excludes demo rows for a real admin (no session)', async () => {
    await expenseModel.findAllForExport({});
    expect(allSql()).toContain('u.is_demo = FALSE');
  });

  it('scopes to one workspace when a session is supplied', async () => {
    await expenseModel.findAllForExport({ demoSessionId: SESSION });
    expect(allSql()).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(allParams()).toContain(SESSION);
  });
});

describe('userModel.findAll demo isolation', () => {
  it('excludes demo users for a real admin', async () => {
    await userModel.findAll();
    expect(allSql()).toContain('WHERE is_demo = FALSE');
  });

  it('scopes to one workspace for a demo admin', async () => {
    await userModel.findAll(SESSION);
    expect(allSql()).toContain('WHERE is_demo = TRUE AND demo_session_id = ?');
    expect(allParams()).toContain(SESSION);
  });
});

describe('auditLogModel.findAll demo isolation', () => {
  it('excludes demo-performed rows for a real admin', async () => {
    await auditLogModel.findAll({});
    expect(allSql()).toContain('performed_by IN (SELECT id FROM users WHERE is_demo = FALSE)');
  });

  it('scopes to one workspace for a demo admin', async () => {
    await auditLogModel.findAll({ demoSessionId: SESSION });
    expect(allSql()).toContain(
      'performed_by IN (SELECT id FROM users WHERE is_demo = TRUE AND demo_session_id = ?)',
    );
    expect(allParams()).toContain(SESSION);
  });
});

describe('auditLogModel.findAllForExport demo isolation', () => {
  it('excludes demo-performed rows for a real admin', async () => {
    await auditLogModel.findAllForExport({});
    expect(allSql()).toContain('u.is_demo = FALSE');
  });

  it('scopes to one workspace when a session is supplied', async () => {
    await auditLogModel.findAllForExport({ demoSessionId: SESSION });
    expect(allSql()).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(allParams()).toContain(SESSION);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRENGTHENED per-call assertions.
//
// The suites above concat all SQL (allSql) before matching, so a leak in ONLY the
// COUNT query (which uses pool.execute) while the DATA query (pool.query) stays
// scoped would still pass. These pin the demo predicate on EACH mock call
// individually — both the count `execute` and the data `query` — and assert the
// session id is bound exactly once per parametrized statement (never dropped from
// one half, never double-bound).
// ─────────────────────────────────────────────────────────────────────────────

/** How many times the demo session id is bound in a single statement's params. */
function sessionBindCount(params: unknown[] | undefined): number {
  return (params ?? []).filter((p) => p === SESSION).length;
}

describe('expenseModel.findAll — per-call demo predicate', () => {
  it('excludes demo rows in BOTH the count (execute) and data (query) statements', async () => {
    await expenseModel.findAll({});

    const [countSql, countParams] = mockedPool.execute.mock.calls[0];
    const [dataSql, dataParams] = mockedPool.query.mock.calls[0];

    expect(countSql).toContain('u.is_demo = FALSE');
    expect(dataSql).toContain('u.is_demo = FALSE');
    expect(countSql).not.toContain('u.is_demo = TRUE');
    expect(dataSql).not.toContain('u.is_demo = TRUE');
    expect(countParams).not.toContain(SESSION);
    expect(dataParams).not.toContain(SESSION);
  });

  it('scopes BOTH statements to the workspace, binding the session once each', async () => {
    await expenseModel.findAll({ demoSessionId: SESSION });

    const [countSql, countParams] = mockedPool.execute.mock.calls[0];
    const [dataSql, dataParams] = mockedPool.query.mock.calls[0];

    expect(countSql).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(dataSql).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(countSql).not.toContain('u.is_demo = FALSE');
    expect(dataSql).not.toContain('u.is_demo = FALSE');
    expect(sessionBindCount(countParams)).toBe(1);
    expect(sessionBindCount(dataParams)).toBe(1);
  });
});

describe('expenseModel.findAllForExport — per-call demo predicate', () => {
  it('excludes demo rows in the export query', async () => {
    await expenseModel.findAllForExport({});
    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('u.is_demo = FALSE');
    expect(params).not.toContain(SESSION);
  });

  it('scopes the export query to the workspace, binding the session once', async () => {
    await expenseModel.findAllForExport({ demoSessionId: SESSION });
    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(sessionBindCount(params)).toBe(1);
  });
});

describe('auditLogModel.findAll — per-call demo predicate', () => {
  it('excludes demo-performed rows in BOTH the count and data statements', async () => {
    await auditLogModel.findAll({});
    const [countSql] = mockedPool.execute.mock.calls[0];
    const [dataSql] = mockedPool.query.mock.calls[0];
    expect(countSql).toContain('performed_by IN (SELECT id FROM users WHERE is_demo = FALSE)');
    expect(dataSql).toContain('performed_by IN (SELECT id FROM users WHERE is_demo = FALSE)');
  });

  it('scopes BOTH statements to the workspace, binding the session once each', async () => {
    await auditLogModel.findAll({ demoSessionId: SESSION });
    const [countSql, countParams] = mockedPool.execute.mock.calls[0];
    const [dataSql, dataParams] = mockedPool.query.mock.calls[0];
    const predicate = 'performed_by IN (SELECT id FROM users WHERE is_demo = TRUE AND demo_session_id = ?)';
    expect(countSql).toContain(predicate);
    expect(dataSql).toContain(predicate);
    expect(sessionBindCount(countParams)).toBe(1);
    expect(sessionBindCount(dataParams)).toBe(1);
  });
});

describe('auditLogModel.findAllForExport — per-call demo predicate', () => {
  it('excludes demo-performed rows in the export query', async () => {
    await auditLogModel.findAllForExport({});
    const [sql] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('u.is_demo = FALSE');
  });

  it('scopes the export query to the workspace, binding the session once', async () => {
    await auditLogModel.findAllForExport({ demoSessionId: SESSION });
    const [sql, params] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('u.is_demo = TRUE AND u.demo_session_id = ?');
    expect(sessionBindCount(params)).toBe(1);
  });
});

describe('statsModel.getOrgStats demo isolation', () => {
  it('excludes demo data from every aggregate for a real admin', async () => {
    await statsModel.getOrgStats();
    const sql = allSql();
    // Both the expense sub-scoping and the user filter must exclude demo rows.
    expect(sql).toContain('submitted_by IN (SELECT id FROM users WHERE is_demo = FALSE)');
    expect(sql).toContain('is_active = 1 AND is_demo = FALSE');
    expect(sql).not.toContain('is_demo = TRUE');
  });

  it('scopes every aggregate to one workspace for a demo admin', async () => {
    await statsModel.getOrgStats(SESSION);
    const sql = allSql();
    expect(sql).toContain('submitted_by IN (SELECT id FROM users WHERE is_demo = TRUE AND demo_session_id = ?)');
    expect(sql).toContain('is_active = 1 AND is_demo = TRUE AND demo_session_id = ?');
    expect(sql).not.toContain('is_demo = FALSE');
    // One placeholder per demo-scoped aggregate — all bound to the session id.
    expect(allParams().every((p) => p === SESSION)).toBe(true);
  });
});
