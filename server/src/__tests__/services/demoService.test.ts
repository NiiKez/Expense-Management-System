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

  it('throws when no signing secret is configured', () => {
    delete process.env.DEMO_JWT_SECRET;
    expect(() => signDemoToken(42, Role.MANAGER)).toThrow('DEMO_JWT_SECRET is not configured');
  });
});

describe('reapExpiredDemoWorkspaces', () => {
  it('deletes expired demo rows in FK-safe order and returns the count', async () => {
    const conn = fakeConnection();
    conn.query
      .mockResolvedValueOnce([[{ id: 11 }, { id: 12 }]]) // SELECT expired ids
      .mockResolvedValue([{}]); // the three DELETEs
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(reapExpiredDemoWorkspaces()).resolves.toBe(2);

    const statements = conn.query.mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => /DELETE FROM audit_logs/.test(s))).toBe(true);
    expect(statements.some((s) => /DELETE FROM expenses/.test(s))).toBe(true);
    expect(statements.some((s) => /DELETE FROM security_events/.test(s))).toBe(true);
    expect(statements.some((s) => /DELETE FROM users/.test(s))).toBe(true);
    // security_events must be cleared BEFORE the users delete (FK-safe ordering).
    const secIdx = statements.findIndex((s) => /DELETE FROM security_events/.test(s));
    const usersIdx = statements.findIndex((s) => /DELETE FROM users/.test(s));
    expect(secIdx).toBeGreaterThanOrEqual(0);
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

  it('schedules a reaper and returns an idempotent stop function', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const stop = startDemoCleanup(1000);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(typeof stop).toBe('function');
    stop();
    stop(); // second call hits the already-cleared guard
  });

  it('logs the reaped count on a tick that removes rows', async () => {
    const conn = fakeConnection();
    conn.query.mockResolvedValueOnce([[{ id: 1 }]]).mockResolvedValue([{}]);
    mockedPool.getConnection.mockResolvedValue(conn);

    const stop = startDemoCleanup(1000);
    await jest.advanceTimersByTimeAsync(1000);

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Demo cleanup: reaped expired demo users',
      { count: 1 },
    );
    stop();
  });

  it('logs an error when a tick fails', async () => {
    mockedPool.getConnection.mockRejectedValueOnce(new Error('boom'));

    const stop = startDemoCleanup(1000);
    await jest.advanceTimersByTimeAsync(1000);

    expect(mockedLogger.error).toHaveBeenCalledWith('Demo cleanup failed', expect.any(Object));
    stop();
  });
});
