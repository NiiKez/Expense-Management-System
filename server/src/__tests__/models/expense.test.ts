import pool from '../../config/db';
import { expenseModel } from '../../models/expense';
import { AppError } from '../../utils/errors';

// These tests run WITHOUT a database: the mysql2 pool is fully mocked so we can
// pin the EXACT SQL text and bound parameters each model method emits. The point
// is defensive — a refactor that reintroduces string-interpolated SQL, drops the
// ORDER BY / SET-column allowlist, or loses a LIKE escape must FAIL here.

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

const mockedPool = pool as unknown as {
  execute: jest.Mock;
  query: jest.Mock;
  getConnection: jest.Mock;
};

interface FakeConn {
  beginTransaction: jest.Mock;
  execute: jest.Mock;
  commit: jest.Mock;
  rollback: jest.Mock;
  release: jest.Mock;
}

function fakeConnection(): FakeConn {
  return {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults; individual tests override with mockResolvedValueOnce.
  mockedPool.execute.mockResolvedValue([[{ total: 0 }]]);
  mockedPool.query.mockResolvedValue([[]]);
});

// ─────────────────────────────────────────────────────────────────────────────
// [CRITICAL] ORDER BY allowlist is actually WIRED at the model call-site.
// resolveSort is unit-tested in isolation elsewhere; these prove the models
// route options.sort/order through it (mapped column, not the raw key), and that
// an unknown/injecting key is a 400 that never reaches the pool as interpolation.
// ─────────────────────────────────────────────────────────────────────────────

describe('expenseModel.findByUserId — ORDER BY allowlist wiring', () => {
  it('maps sort=amount,order=asc to the trusted column in the DATA query', async () => {
    await expenseModel.findByUserId(1, { sort: 'amount', order: 'asc' });

    // Data query is issued via pool.query and carries the ORDER BY.
    const [dataSql] = mockedPool.query.mock.calls[0];
    expect(dataSql).toContain('ORDER BY amount ASC, id DESC');
  });

  it('maps the public key to its column (date -> expense_date), never the raw key', async () => {
    await expenseModel.findByUserId(1, { sort: 'date', order: 'desc' });

    const [dataSql] = mockedPool.query.mock.calls[0];
    expect(dataSql).toContain('ORDER BY expense_date DESC');
    expect(dataSql).not.toContain('ORDER BY date ');
  });

  it('rejects a non-whitelisted / injecting sort key with a 400 and issues NO query', async () => {
    await expect(
      expenseModel.findByUserId(1, { sort: 'amount; DROP TABLE users', order: 'asc' }),
    ).rejects.toBeInstanceOf(AppError);

    // resolveSort runs before either query, so nothing is interpolated / executed.
    expect(mockedPool.execute).not.toHaveBeenCalled();
    expect(mockedPool.query).not.toHaveBeenCalled();

    await expenseModel
      .findByUserId(1, { sort: 'amount; DROP TABLE users' })
      .catch((err: AppError) => {
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('Invalid sort field');
      });
  });
});

describe('expenseModel.findByUserIdForExport — ORDER BY allowlist wiring', () => {
  it('maps sort=status,order=asc to the trusted column', async () => {
    await expenseModel.findByUserIdForExport(1, { sort: 'status', order: 'asc' });
    const [sql] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('ORDER BY status ASC, id DESC');
  });

  it('rejects an unknown sort key with a 400 and issues NO query', async () => {
    await expect(
      expenseModel.findByUserIdForExport(1, { sort: 'evil' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockedPool.query).not.toHaveBeenCalled();
  });
});

describe('expenseModel.findAll — admin ORDER BY allowlist wiring', () => {
  it('maps the admin key submitter -> u.display_name in the DATA query', async () => {
    mockedPool.execute.mockResolvedValue([[{ total: 0 }]]);
    await expenseModel.findAll({ sort: 'submitter', order: 'asc' });

    const [dataSql] = mockedPool.query.mock.calls[0];
    expect(dataSql).toContain('ORDER BY u.display_name ASC, e.id DESC');
    // The raw key must never appear as an identifier.
    expect(dataSql).not.toContain('submitter ASC');
  });

  it('rejects an unknown admin sort key with a 400 and issues NO query', async () => {
    await expect(
      expenseModel.findAll({ sort: 'password); DROP TABLE users;--' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockedPool.execute).not.toHaveBeenCalled();
    expect(mockedPool.query).not.toHaveBeenCalled();
  });
});

describe('expenseModel.findAllForExport — admin ORDER BY allowlist wiring', () => {
  it('maps submitter -> u.display_name', async () => {
    await expenseModel.findAllForExport({ sort: 'submitter', order: 'desc' });
    const [sql] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('ORDER BY u.display_name DESC, e.id DESC');
  });

  it('rejects an unknown sort key with a 400 and issues NO query', async () => {
    await expect(
      expenseModel.findAllForExport({ sort: 'e.amount--' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockedPool.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [HIGH] escapeLike — LIKE wildcards in user input are neutralized and the
// ESCAPE '\\' clause is kept, so "50%" can't act as a wildcard pattern.
// ─────────────────────────────────────────────────────────────────────────────

describe('expenseModel.findByUserId — LIKE-wildcard escaping', () => {
  it('escapes %, _ and \\ in the search term and keeps the ESCAPE clause', async () => {
    await expenseModel.findByUserId(1, { search: '50%_x\\' });

    // % _ and \ each get a backslash prefix; wrapped in %...% for the LIKE.
    const escaped = '%50\\%\\_x\\\\%';

    const [countSql, countParams] = mockedPool.execute.mock.calls[0];
    expect(countSql).toContain("title LIKE ? ESCAPE '\\\\'");
    expect(countParams).toContain(escaped);

    const [dataSql, dataParams] = mockedPool.query.mock.calls[0];
    expect(dataSql).toContain("title LIKE ? ESCAPE '\\\\'");
    expect(dataParams).toContain(escaped);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [HIGH] Dynamic SET whitelist in update()/resubmit(). Only UPDATE_FIELDS
// columns may be built into the SET list; an unknown key is dropped, never
// interpolated as an identifier, and excluded from appliedFields.
// ─────────────────────────────────────────────────────────────────────────────

describe('expenseModel.update — SET-column whitelist', () => {
  it('builds SET from whitelisted columns only and drops the unknown key', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[{ id: 1 }]]); // findById re-read

    const { appliedFields } = await expenseModel.update(
      1,
      { title: 'a', amount: 5, evil: 'x' } as never,
      1,
    );

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('SET title = ?, amount = ?, version = version + 1');
    expect(sql).toContain(
      "WHERE id = ? AND version = ? AND status = 'PENDING' AND deleted_at IS NULL",
    );
    // "evil" must never leak into the SQL as an identifier or into the params.
    expect(sql).not.toContain('evil');
    expect(params).toEqual(['a', 5, 1, 1]);

    // The model reports exactly the whitelisted columns it applied.
    expect(appliedFields).toEqual(['title', 'amount']);
    expect(appliedFields).not.toContain('evil');
  });

  it('short-circuits with no UPDATE when every provided key is non-whitelisted', async () => {
    mockedPool.execute.mockResolvedValueOnce([[{ id: 1 }]]); // findById only

    const { appliedFields } = await expenseModel.update(1, { evil: 'x' } as never, 1);

    // No fields to set -> takes the findById-only path (a single SELECT, no UPDATE).
    expect(appliedFields).toEqual([]);
    expect(mockedPool.execute).toHaveBeenCalledTimes(1);
    const [sql] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('SELECT * FROM expenses WHERE id = ?');
    expect(sql).not.toContain('UPDATE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [HIGH] Transaction rollback / optimistic-concurrency branches.
// ─────────────────────────────────────────────────────────────────────────────

describe('expenseModel.createSubmission — transaction integrity', () => {
  const baseParams = {
    expense: {
      submitted_by: 7,
      title: 'Lunch',
      description: null,
      amount: 12.5,
      currency: 'USD',
      category: 'MEALS',
      expense_date: '2026-01-01',
    },
    receipt: null,
    ipAddress: '10.0.0.1',
  };

  it('commits the expense + audit insert and returns the re-read row', async () => {
    const conn = fakeConnection();
    conn.execute
      .mockResolvedValueOnce([{ insertId: 5 }]) // INSERT expenses
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT audit_logs
      .mockResolvedValueOnce([[{ id: 5, title: 'Lunch' }]]); // SELECT re-read
    mockedPool.getConnection.mockResolvedValue(conn);

    const result = await expenseModel.createSubmission(baseParams);

    // Expense INSERT: exact params, positional & escaped by the driver.
    const [expSql, expParams] = conn.execute.mock.calls[0];
    expect(expSql).toContain('INSERT INTO expenses');
    expect(expParams).toEqual([7, 'Lunch', null, 12.5, 'USD', 'MEALS', '2026-01-01']);

    // Audit INSERT is part of the SAME transaction (hard-coded SUBMITTED/PENDING).
    const [auditSql, auditParams] = conn.execute.mock.calls[1];
    expect(auditSql).toContain('INSERT INTO audit_logs');
    expect(auditSql).toContain("'SUBMITTED'");
    expect(auditParams).toEqual([5, 7, '10.0.0.1']);

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(result.expense).toEqual({ id: 5, title: 'Lunch' });
  });

  it('rolls back and rethrows when the expense INSERT fails', async () => {
    const conn = fakeConnection();
    conn.execute.mockRejectedValueOnce(new Error('insert exploded'));
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(expenseModel.createSubmission(baseParams)).rejects.toThrow('insert exploded');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back (never commits) when the pre-commit re-read returns no row', async () => {
    const conn = fakeConnection();
    conn.execute
      .mockResolvedValueOnce([{ insertId: 5 }]) // INSERT expenses
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT audit_logs
      .mockResolvedValueOnce([[]]); // re-read finds nothing
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(expenseModel.createSubmission(baseParams)).rejects.toThrow(
      /Failed to load expense after insert/,
    );

    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('inserts the receipt inside the same transaction when one is supplied', async () => {
    const conn = fakeConnection();
    conn.execute
      .mockResolvedValueOnce([{ insertId: 5 }]) // INSERT expenses
      .mockResolvedValueOnce([{ insertId: 9 }]) // INSERT receipts
      .mockResolvedValueOnce([[{ id: 9, file_name: 'r.pdf' }]]) // SELECT receipt
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT audit_logs
      .mockResolvedValueOnce([[{ id: 5 }]]); // SELECT re-read
    mockedPool.getConnection.mockResolvedValue(conn);

    const result = await expenseModel.createSubmission({
      ...baseParams,
      receipt: { file_name: 'r.pdf', file_path: '/x/r.pdf', mime_type: 'application/pdf', file_size: 42 },
    });

    const [recSql, recParams] = conn.execute.mock.calls[1];
    expect(recSql).toContain('INSERT INTO receipts');
    expect(recParams).toEqual([5, 'r.pdf', '/x/r.pdf', 'application/pdf', 42]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(result.receipt).toEqual({ id: 9, file_name: 'r.pdf' });
  });
});

describe('expenseModel.resubmit — SET whitelist + concurrency branches', () => {
  function connWithForUpdate(row: { id: number; version: number; status: string } | null) {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute
      // SELECT ... FOR UPDATE
      .mockResolvedValueOnce([row ? [row] : []])
      // UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // SELECT re-read
      .mockResolvedValueOnce([[{ id: row?.id, status: 'PENDING' }]]);
    return conn;
  }

  it('applies only whitelisted columns + the fixed transition columns, dropping unknown keys', async () => {
    const conn = connWithForUpdate({ id: 1, version: 2, status: 'REJECTED' });
    mockedPool.getConnection.mockResolvedValue(conn);

    const { result, appliedFields } = await expenseModel.resubmit(
      1,
      { title: 'a', amount: 5, evil: 'x' } as never,
      2,
    );

    expect(result).toBe('SUCCESS');
    const [updateSql, updateParams] = conn.execute.mock.calls[1];
    expect(updateSql).toContain(
      "SET title = ?, amount = ?, status = 'PENDING', rejection_reason = NULL, approved_by = NULL, version = version + 1",
    );
    expect(updateSql).not.toContain('evil');
    expect(updateParams).toEqual(['a', 5, 1, 2]);
    expect(appliedFields).toEqual(['title', 'amount']);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_FOUND and rolls back (no commit) when the row is gone', async () => {
    const conn = connWithForUpdate(null);
    mockedPool.getConnection.mockResolvedValue(conn);

    const { result } = await expenseModel.resubmit(1, { title: 'a' }, 1);
    expect(result).toBe('NOT_FOUND');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('returns NOT_REJECTED and rolls back when the current status is not REJECTED', async () => {
    const conn = connWithForUpdate({ id: 1, version: 2, status: 'PENDING' });
    mockedPool.getConnection.mockResolvedValue(conn);

    const { result } = await expenseModel.resubmit(1, { title: 'a' }, 2);
    expect(result).toBe('NOT_REJECTED');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('returns CONFLICT on a stale version and rolls back before any UPDATE', async () => {
    const conn = connWithForUpdate({ id: 1, version: 3, status: 'REJECTED' });
    mockedPool.getConnection.mockResolvedValue(conn);

    const { result } = await expenseModel.resubmit(1, { title: 'a' }, 2); // expected 2 != actual 3
    expect(result).toBe('CONFLICT');
    // Only the FOR UPDATE select ran; the UPDATE was never reached.
    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the guarded UPDATE affects 0 rows (lost race)', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1, version: 2, status: 'REJECTED' }]]) // FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // UPDATE hits nothing
    mockedPool.getConnection.mockResolvedValue(conn);

    const { result } = await expenseModel.resubmit(1, { title: 'a' }, 2);
    expect(result).toBe('CONFLICT');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when a statement throws mid-transaction', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute.mockRejectedValueOnce(new Error('select for update failed'));
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(expenseModel.resubmit(1, { title: 'a' }, 2)).rejects.toThrow(
      'select for update failed',
    );
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('expenseModel.delete — concurrency branches', () => {
  it('soft-deletes and commits, writing the DELETED audit row first', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1, version: 2, status: 'PENDING' }]]) // FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT audit_logs
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE soft-delete
    mockedPool.getConnection.mockResolvedValue(conn);

    const result = await expenseModel.delete(1, 7, 2, '10.0.0.1');
    expect(result).toBe('SUCCESS');

    expect(conn.execute.mock.calls[1][0]).toContain('INSERT INTO audit_logs');
    expect(conn.execute.mock.calls[1][0]).toContain("'DELETED'");
    const [updSql, updParams] = conn.execute.mock.calls[2];
    expect(updSql).toContain('SET deleted_at = CURRENT_TIMESTAMP');
    expect(updSql).toContain("WHERE id = ? AND version = ? AND status = 'PENDING' AND deleted_at IS NULL");
    expect(updParams).toEqual([7, 1, 2]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_FOUND and rolls back when the row is missing', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[]]); // FOR UPDATE finds nothing
    mockedPool.getConnection.mockResolvedValue(conn);

    const result = await expenseModel.delete(1, 7, 2, null);
    expect(result).toBe('NOT_FOUND');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('returns CONFLICT (rollback, no audit/update) on a non-PENDING or stale row', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute.mockResolvedValueOnce([[{ id: 1, version: 9, status: 'PENDING' }]]); // version mismatch
    mockedPool.getConnection.mockResolvedValue(conn);

    const result = await expenseModel.delete(1, 7, 2, null); // expected 2 != actual 9
    expect(result).toBe('CONFLICT');
    expect(conn.execute).toHaveBeenCalledTimes(1); // no audit insert, no update
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('returns CONFLICT when the guarded UPDATE affects 0 rows', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute
      .mockResolvedValueOnce([[{ id: 1, version: 2, status: 'PENDING' }]]) // FOR UPDATE
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // audit insert
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // UPDATE lost the race
    mockedPool.getConnection.mockResolvedValue(conn);

    const result = await expenseModel.delete(1, 7, 2, null);
    expect(result).toBe('CONFLICT');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when a statement throws mid-transaction', async () => {
    const conn = fakeConnection();
    conn.execute.mockReset();
    conn.execute.mockRejectedValueOnce(new Error('boom'));
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(expenseModel.delete(1, 7, 2, null)).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [MEDIUM] IN-list placeholder building + empty-array short-circuit.
// ─────────────────────────────────────────────────────────────────────────────

describe('expenseModel.findPendingBySubmitterIds — IN-list handling', () => {
  it('short-circuits an empty id list with NO pool call (never emits "IN ()")', async () => {
    const result = await expenseModel.findPendingBySubmitterIds([]);
    expect(result).toEqual({ data: [], total: 0 });
    expect(mockedPool.query).not.toHaveBeenCalled();
    expect(mockedPool.execute).not.toHaveBeenCalled();
  });

  it('builds one placeholder per id and binds the ids in BOTH count and data queries', async () => {
    mockedPool.query.mockResolvedValue([[{ total: 0 }]]);

    await expenseModel.findPendingBySubmitterIds([3, 4, 5]);

    // Count query (first pool.query call).
    const [countSql, countParams] = mockedPool.query.mock.calls[0];
    expect(countSql).toContain('submitted_by IN (?, ?, ?)');
    expect(countParams).toEqual([3, 4, 5]);

    // Data query (second pool.query call) stays in sync: same placeholders + ids.
    const [dataSql, dataParams] = mockedPool.query.mock.calls[1];
    expect(dataSql).toContain('e.submitted_by IN (?, ?, ?)');
    expect(dataParams.slice(0, 3)).toEqual([3, 4, 5]);
  });
});
