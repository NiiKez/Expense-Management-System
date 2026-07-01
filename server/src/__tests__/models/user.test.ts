import pool from '../../config/db';
import { userModel } from '../../models/user';
import { Role } from '../../types';

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

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock; getConnection: jest.Mock };

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
});

describe('userModel.setOrgAttributes', () => {
  it('builds an allowlisted UPDATE with only the provided columns', async () => {
    mockedPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

    await userModel.setOrgAttributes(7, { department: 'Eng', job_title: 'SWE' });

    expect(mockedPool.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('UPDATE users SET department = ?, job_title = ? WHERE id = ?');
    expect(params).toEqual(['Eng', 'SWE', 7]);
  });

  it('writes explicit nulls but skips undefined keys', async () => {
    mockedPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

    await userModel.setOrgAttributes(7, {
      department: null,
      employee_id: 'E-1',
      office_location: undefined,
    });

    const [sql, params] = mockedPool.execute.mock.calls[0];
    // office_location is undefined → omitted; department null → written.
    expect(sql).toBe('UPDATE users SET department = ?, employee_id = ? WHERE id = ?');
    expect(params).toEqual([null, 'E-1', 7]);
  });

  it('is a no-op (no query) for an empty patch', async () => {
    await userModel.setOrgAttributes(7, {});
    expect(mockedPool.execute).not.toHaveBeenCalled();
  });
});

describe('userModel.syncOrgAttributesForUsers', () => {
  it('issues one UPDATE per record', async () => {
    mockedPool.execute.mockResolvedValue([{ affectedRows: 1 }]);

    await userModel.syncOrgAttributesForUsers([
      { id: 1, department: 'Eng', job_title: 'SWE', employee_id: 'E1', office_location: 'Berlin' },
      { id: 2, department: 'Sales', job_title: 'AE', employee_id: 'E2', office_location: 'Paris' },
    ]);

    expect(mockedPool.execute).toHaveBeenCalledTimes(2);
    const ids = mockedPool.execute.mock.calls.map((call) => call[1][call[1].length - 1]);
    expect(ids.sort()).toEqual([1, 2]);
  });

  it('does nothing for an empty record set', async () => {
    await userModel.syncOrgAttributesForUsers([]);
    expect(mockedPool.execute).not.toHaveBeenCalled();
  });
});

describe('userModel.replaceUserGroups', () => {
  it('deletes then multi-row inserts inside a committed transaction', async () => {
    const conn = fakeConnection();
    mockedPool.getConnection.mockResolvedValue(conn);

    await userModel.replaceUserGroups(7, [
      { group_id: 'g1', group_name: 'Engineering' },
      { group_id: 'g2', group_name: null },
    ]);

    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    // First statement clears the old set.
    expect(conn.execute.mock.calls[0][0]).toBe('DELETE FROM user_groups WHERE user_id = ?');
    expect(conn.execute.mock.calls[0][1]).toEqual([7]);
    // Second statement is a single multi-row INSERT.
    const [insertSql, insertParams] = conn.execute.mock.calls[1];
    expect(insertSql).toBe('INSERT INTO user_groups (user_id, group_id, group_name) VALUES (?, ?, ?), (?, ?, ?)');
    expect(insertParams).toEqual([7, 'g1', 'Engineering', 7, 'g2', null]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it('deletes only (no INSERT) when the new set is empty', async () => {
    const conn = fakeConnection();
    mockedPool.getConnection.mockResolvedValue(conn);

    await userModel.replaceUserGroups(7, []);

    expect(conn.execute).toHaveBeenCalledTimes(1);
    expect(conn.execute.mock.calls[0][0]).toBe('DELETE FROM user_groups WHERE user_id = ?');
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('dedupes by group_id before inserting', async () => {
    const conn = fakeConnection();
    mockedPool.getConnection.mockResolvedValue(conn);

    await userModel.replaceUserGroups(7, [
      { group_id: 'g1', group_name: 'First' },
      { group_id: 'g1', group_name: 'Duplicate' },
    ]);

    const [insertSql, insertParams] = conn.execute.mock.calls[1];
    expect(insertSql).toBe('INSERT INTO user_groups (user_id, group_id, group_name) VALUES (?, ?, ?)');
    // Last write wins on the dedupe.
    expect(insertParams).toEqual([7, 'g1', 'Duplicate']);
  });

  it('rolls back and releases when the INSERT fails', async () => {
    const conn = fakeConnection();
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // DELETE ok
      .mockRejectedValueOnce(new Error('insert blew up')); // INSERT fails
    mockedPool.getConnection.mockResolvedValue(conn);

    await expect(
      userModel.replaceUserGroups(7, [{ group_id: 'g1', group_name: 'X' }]),
    ).rejects.toThrow('insert blew up');

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});

describe('userModel.getUserGroups', () => {
  it('selects the caller groups ordered by name', async () => {
    const rows = [{ group_id: 'g1', group_name: 'Alpha' }];
    mockedPool.execute.mockResolvedValue([rows]);

    const result = await userModel.getUserGroups(7);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('SELECT group_id, group_name FROM user_groups WHERE user_id = ? ORDER BY group_name ASC');
    expect(params).toEqual([7]);
    expect(result).toBe(rows);
  });
});

describe('userModel.findById / findByEntraId / findByManagerId param binding', () => {
  it('findById binds the numeric id and returns the row', async () => {
    const row = { id: 7 };
    mockedPool.execute.mockResolvedValue([[row]]);

    const result = await userModel.findById(7);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('SELECT * FROM users WHERE id = ?');
    expect(params).toEqual([7]);
    expect(result).toBe(row);
  });

  it('findById returns null when no row matches', async () => {
    mockedPool.execute.mockResolvedValue([[]]);
    expect(await userModel.findById(404)).toBeNull();
  });

  it('findByEntraId binds the oid string', async () => {
    const row = { id: 7, entra_id: 'oid-123' };
    mockedPool.execute.mockResolvedValue([[row]]);

    const result = await userModel.findByEntraId('oid-123');

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('SELECT * FROM users WHERE entra_id = ?');
    expect(params).toEqual(['oid-123']);
    expect(result).toBe(row);
  });

  it('findByManagerId binds the manager id and orders by name', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockedPool.execute.mockResolvedValue([rows]);

    const result = await userModel.findByManagerId(9);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('SELECT * FROM users WHERE manager_id = ? ORDER BY display_name ASC');
    expect(params).toEqual([9]);
    expect(result).toBe(rows);
  });
});

describe('userModel.upsertByEntraId', () => {
  it('emits INSERT ... ON DUPLICATE KEY UPDATE with the right params then re-reads by entra_id', async () => {
    const row = { id: 7, entra_id: 'oid-123', email: 'a@b.com', display_name: 'Alice', role: Role.MANAGER };
    mockedPool.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // upsert
      .mockResolvedValueOnce([[row]]); // findByEntraId re-read

    const result = await userModel.upsertByEntraId({
      entra_id: 'oid-123',
      email: 'a@b.com',
      display_name: 'Alice',
      role: Role.MANAGER,
    });

    // Upsert statement.
    const [insertSql, insertParams] = mockedPool.execute.mock.calls[0];
    expect(insertSql).toContain('INSERT INTO users (entra_id, email, display_name, role)');
    expect(insertSql).toContain('ON DUPLICATE KEY UPDATE');
    expect(insertSql).toContain('email = VALUES(email)');
    expect(insertSql).toContain('display_name = VALUES(display_name)');
    // Role is not overwritten on a conflict — the token is the source of truth on
    // insert, but an existing row's role stays synced elsewhere.
    expect(insertSql).not.toContain('role = VALUES(role)');
    expect(insertParams).toEqual(['oid-123', 'a@b.com', 'Alice', Role.MANAGER]);

    // Re-read is scoped by entra_id, not insertId (upsert may not insert).
    const [readSql, readParams] = mockedPool.execute.mock.calls[1];
    expect(readSql).toBe('SELECT * FROM users WHERE entra_id = ?');
    expect(readParams).toEqual(['oid-123']);

    expect(result).toBe(row);
  });

  it('throws if the row cannot be loaded back after the upsert', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]]); // re-read finds nothing

    await expect(
      userModel.upsertByEntraId({
        entra_id: 'oid-x',
        email: 'x@y.com',
        display_name: 'X',
        role: Role.EMPLOYEE,
      }),
    ).rejects.toThrow('Failed to load user after upsert (entra_id=oid-x)');
  });
});

describe('userModel.updateRole (privilege-change write)', () => {
  it("binds ['ADMIN', id] in that order and re-reads on success", async () => {
    const row = { id: 7, role: Role.ADMIN };
    mockedPool.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[row]]); // findById re-read

    const result = await userModel.updateRole(7, Role.ADMIN);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('UPDATE users SET role = ? WHERE id = ?');
    // Role first, id second — a swapped order would set role to the id.
    expect(params).toEqual([Role.ADMIN, 7]);

    // Re-read scoped to the same id.
    const [readSql, readParams] = mockedPool.execute.mock.calls[1];
    expect(readSql).toBe('SELECT * FROM users WHERE id = ?');
    expect(readParams).toEqual([7]);

    expect(result).toBe(row);
  });

  it('returns null (no re-read) when no row was updated', async () => {
    mockedPool.execute.mockResolvedValueOnce([{ affectedRows: 0 }]); // UPDATE hits nothing

    const result = await userModel.updateRole(404, Role.ADMIN);

    expect(result).toBeNull();
    // Only the UPDATE ran — the row lookup is skipped on affectedRows === 0.
    expect(mockedPool.execute).toHaveBeenCalledTimes(1);
  });
});
