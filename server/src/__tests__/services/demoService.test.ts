import pool from '../../config/db';
import logger from '../../config/logger';
import jwt from 'jsonwebtoken';
import {
  createDemoWorkspace,
  countActiveDemoSessions,
  canCreateDemoWorkspace,
  signDemoToken,
  reapExpiredDemoWorkspaces,
  startDemoCleanup,
} from '../../services/demoService';
import { Role } from '../../types';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getConnection: jest.fn(), query: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('jsonwebtoken');

const mockedPool = pool as unknown as { getConnection: jest.Mock; query: jest.Mock };
const mockedLogger = logger as unknown as { info: jest.Mock; error: jest.Mock };
const mockedJwt = jwt as jest.Mocked<typeof jwt>;

interface FakeConn {
  beginTransaction: jest.Mock;
  execute: jest.Mock;
  query: jest.Mock;
  commit: jest.Mock;
  rollback: jest.Mock;
  release: jest.Mock;
}

function fakeConnection(): FakeConn {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue([{ insertId: 1 }]),
    query: jest.fn().mockResolvedValue([[]]),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEMO_JWT_SECRET = 'unit-demo-secret';
  delete process.env.DEMO_SESSION_TTL_SECONDS;
  delete process.env.DEMO_MAX_ACTIVE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('createDemoWorkspace', () => {
  it('seeds an admin, manager, two reports and their expenses inside one transaction', async () => {
    const conn = fakeConnection();
    let nextId = 0;
    // Hand out incrementing insertIds so we can verify the per-role mapping:
    // admin(1), manager(2), emp1/Jordan(3), emp2/Sam(4), then expenses.
    conn.execute.mockImplementation(() => Promise.resolve([{ insertId: ++nextId }]));
    mockedPool.getConnection.mockResolvedValue(conn);

    const workspace = await createDemoWorkspace();

    expect(workspace.usersByRole).toEqual({
      [Role.ADMIN]: 1,
      [Role.MANAGER]: 2,
      [Role.EMPLOYEE]: 3, // the first report (Jordan Lee)
    });
    expect(typeof workspace.sessionId).toBe('string');
    expect(workspace.expiresAt).toBeInstanceOf(Date);

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);

    // 4 demo users + 7 seeded expenses (each with at least a SUBMITTED audit row,
    // plus an extra row for the approved/rejected ones).
    const userInserts = conn.execute.mock.calls.filter((c) => /INSERT INTO users/.test(c[0]));
    const expenseInserts = conn.execute.mock.calls.filter((c) => /INSERT INTO expenses/.test(c[0]));
    expect(userInserts).toHaveLength(4);
    expect(expenseInserts).toHaveLength(7);

    // The four users cover ADMIN, MANAGER, EMPLOYEE, EMPLOYEE (role is the 4th
    // bound param of the users INSERT).
    const roles = userInserts.map((c) => c[1][3]);
    expect(roles).toEqual([Role.ADMIN, Role.MANAGER, Role.EMPLOYEE, Role.EMPLOYEE]);

    // All four share one demo_session_id (the last bound param) and are flagged
    // is_demo (TRUE is baked into the INSERT SQL).
    const sessionIds = new Set(userInserts.map((c) => c[1][c[1].length - 1]));
    expect(sessionIds.size).toBe(1);
    expect(userInserts.every((c) => /is_demo/.test(c[0]) && /VALUES[^)]*TRUE/.test(c[0]))).toBe(true);

    expect(mockedLogger.info).toHaveBeenCalledWith('Created demo workspace', expect.any(Object));
  });

  it('stamps expiresAt at now + configured TTL and binds that TTL on every user INSERT', async () => {
    // TZ is pinned UTC (jest.config), so Date math is host-independent.
    process.env.DEMO_SESSION_TTL_SECONDS = '600';
    const conn = fakeConnection();
    let nextId = 0;
    conn.execute.mockImplementation(() => Promise.resolve([{ insertId: ++nextId }]));
    mockedPool.getConnection.mockResolvedValue(conn);

    const before = Date.now();
    const workspace = await createDemoWorkspace();
    const after = Date.now();

    // expiresAt ≈ Date.now() + ttl*1000, taken at some instant during the call.
    expect(workspace.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600 * 1000);
    expect(workspace.expiresAt.getTime()).toBeLessThanOrEqual(after + 600 * 1000);

    // The DATE_ADD ttl bind param (6th, index 5) on each users INSERT is the same
    // configured TTL, so the row-level demo_expires_at tracks the token lifetime.
    const userInserts = conn.execute.mock.calls.filter((c) => /INSERT INTO users/.test(c[0]));
    expect(userInserts).toHaveLength(4);
    expect(userInserts.every((c) => c[1][5] === 600)).toBe(true);
  });

  it('rolls back and rethrows when seeding fails', async () => {
    const conn = fakeConnection();
    conn.execute.mockRejectedValueOnce(new Error('insert failed'));
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(createDemoWorkspace()).rejects.toThrow('insert failed');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('countActiveDemoSessions', () => {
  it('returns the distinct live-session count', async () => {
    mockedPool.query.mockResolvedValue([[{ count: 3 }]]);
    await expect(countActiveDemoSessions()).resolves.toBe(3);
  });

  it('coerces a missing count to 0', async () => {
    mockedPool.query.mockResolvedValue([[{ count: undefined }]]);
    await expect(countActiveDemoSessions()).resolves.toBe(0);
  });
});

describe('canCreateDemoWorkspace', () => {
  it('allows creation below the cap', async () => {
    mockedPool.query.mockResolvedValue([[{ count: 3 }]]);
    await expect(canCreateDemoWorkspace()).resolves.toBe(true);
  });

  it('blocks creation at or above the cap', async () => {
    process.env.DEMO_MAX_ACTIVE = '2';
    mockedPool.query.mockResolvedValue([[{ count: 3 }]]);
    await expect(canCreateDemoWorkspace()).resolves.toBe(false);
  });
});

describe('signDemoToken', () => {
  it('signs an HS256 token carrying the demo claim', () => {
    mockedJwt.sign.mockReturnValue('signed.demo.jwt' as never);

    const token = signDemoToken(42, Role.MANAGER);

    expect(token).toBe('signed.demo.jwt');
    expect(mockedJwt.sign).toHaveBeenCalledWith(
      { sub: '42', demo: true, role: Role.MANAGER },
      'unit-demo-secret',
      expect.objectContaining({ algorithm: 'HS256' }),
    );
  });

  it('forwards the default demo TTL as expiresIn (the session lifecycle boundary)', () => {
    // With no override, the token must expire at the configured default (2h). A
    // dropped expiresIn would mint an eternal demo token and fail this.
    mockedJwt.sign.mockReturnValue('signed.demo.jwt' as never);

    signDemoToken(42, Role.MANAGER);

    expect(mockedJwt.sign).toHaveBeenCalledWith(
      expect.anything(),
      'unit-demo-secret',
      expect.objectContaining({ algorithm: 'HS256', expiresIn: 2 * 60 * 60 }),
    );
  });

  it('forwards the CONFIGURED DEMO_SESSION_TTL_SECONDS as expiresIn (not hardcoded)', () => {
    process.env.DEMO_SESSION_TTL_SECONDS = '900';
    mockedJwt.sign.mockReturnValue('signed.demo.jwt' as never);

    signDemoToken(42, Role.EMPLOYEE);

    expect(mockedJwt.sign).toHaveBeenCalledWith(
      expect.anything(),
      'unit-demo-secret',
      expect.objectContaining({ expiresIn: 900 }),
    );
  });

  it('throws when no signing secret is configured', () => {
    delete process.env.DEMO_JWT_SECRET;
    expect(() => signDemoToken(42, Role.MANAGER)).toThrow('DEMO_JWT_SECRET is not configured');
  });
});

describe('reapExpiredDemoWorkspaces', () => {
  it('selects whole expired workspaces and deletes in strict FK-safe order', async () => {
    const conn = fakeConnection();
    conn.query
      .mockResolvedValueOnce([[{ id: 11 }, { id: 12 }]]) // SELECT user ids of expired sessions
      .mockResolvedValue([{}]); // the four DELETEs
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(reapExpiredDemoWorkspaces()).resolves.toBe(2);

    const statements = conn.query.mock.calls.map((c) => String(c[0]));
    // The id selection is by whole demo_session_id, never a raw per-user LIMIT —
    // so a batch boundary can never split a workspace and RESTRICT-wedge the tick.
    expect(statements[0]).toMatch(/demo_session_id IN \(/);
    expect(statements[0]).toMatch(/demo_expires_at < NOW\(\)/);
    expect(statements[0]).not.toMatch(/FROM users WHERE is_demo = TRUE AND demo_expires_at < NOW\(\) LIMIT/);

    const auditIdx = statements.findIndex((s) => /DELETE FROM audit_logs/.test(s));
    const expensesIdx = statements.findIndex((s) => /DELETE FROM expenses/.test(s));
    const secIdx = statements.findIndex((s) => /DELETE FROM security_events/.test(s));
    const usersIdx = statements.findIndex((s) => /DELETE FROM users/.test(s));
    // audit_logs → expenses → security_events → users: any reordering would trip a
    // FK RESTRICT, so assert the full chain rather than just one pair.
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeLessThan(expensesIdx);
    expect(expensesIdx).toBeLessThan(secIdx);
    expect(secIdx).toBeLessThan(usersIdx);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('commits without deleting when nothing has expired', async () => {
    const conn = fakeConnection();
    conn.query.mockResolvedValueOnce([[]]);
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(reapExpiredDemoWorkspaces()).resolves.toBe(0);
    expect(conn.query).toHaveBeenCalledTimes(1); // only the SELECT
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows on failure', async () => {
    const conn = fakeConnection();
    conn.query.mockRejectedValueOnce(new Error('db down'));
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(reapExpiredDemoWorkspaces()).rejects.toThrow('db down');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('startDemoCleanup', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('schedules a reaper and returns an idempotent stop function', async () => {
    const conn = fakeConnection();
    conn.query.mockResolvedValue([[]]); // immediate tick reaps nothing
    mockedPool.getConnection.mockResolvedValue(conn);
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const stop = startDemoCleanup(1000);
    await jest.advanceTimersByTimeAsync(0); // let the immediate tick settle

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(typeof stop).toBe('function');
    stop();
    stop(); // second call is a harmless no-op (clearInterval is idempotent)
  });

  it('reaps immediately on start (before the first interval elapses)', async () => {
    const conn = fakeConnection();
    conn.query.mockResolvedValueOnce([[{ id: 1 }]]).mockResolvedValue([{}]);
    mockedPool.getConnection.mockResolvedValue(conn);

    const stop = startDemoCleanup(1000);
    // No timer advance: the eager tick must run so a scale-to-zero cold start (or
    // a boot-time backlog) is reaped even if the container never lives an interval.
    await jest.advanceTimersByTimeAsync(0);

    expect(mockedPool.getConnection).toHaveBeenCalledTimes(1);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Demo cleanup: reaped expired demo users',
      { count: 1 },
    );
    stop();
  });

  it('logs the reaped count on a scheduled tick that removes rows', async () => {
    const conn = fakeConnection();
    conn.query.mockResolvedValue([[]]); // immediate tick: nothing to reap
    mockedPool.getConnection.mockResolvedValue(conn);

    const stop = startDemoCleanup(1000);
    await jest.advanceTimersByTimeAsync(0);

    // A later interval tick now finds an expired workspace.
    conn.query.mockReset();
    conn.query.mockResolvedValueOnce([[{ id: 1 }]]).mockResolvedValue([{}]);
    await jest.advanceTimersByTimeAsync(1000);

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Demo cleanup: reaped expired demo users',
      { count: 1 },
    );
    stop();
  });

  it('logs an error when a tick fails without unscheduling the reaper', async () => {
    mockedPool.getConnection.mockRejectedValue(new Error('boom'));

    const stop = startDemoCleanup(1000);
    await jest.advanceTimersByTimeAsync(0); // immediate tick fails

    expect(mockedLogger.error).toHaveBeenCalledWith('Demo cleanup failed', expect.any(Object));
    stop();
  });
});
