import pool from '../../config/db';
import { commentModel } from '../../models/comment';
import { Role } from '../../types';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };

const commentRow = {
  id: 42,
  expense_id: 7,
  author_id: 3,
  body: 'Looks good to me',
  author_name: 'Alice',
  author_role: Role.MANAGER,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('commentModel.create', () => {
  it('inserts (expense_id, author_id, body) with placeholders then re-reads via findById', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ insertId: 42 }]) // INSERT
      .mockResolvedValueOnce([[commentRow]]); // findById re-read

    const result = await commentModel.create({ expense_id: 7, author_id: 3, body: 'Looks good to me' });

    expect(mockedPool.execute).toHaveBeenCalledTimes(2);

    // First call: the INSERT with exactly (expense_id, author_id, body).
    const [insertSql, insertParams] = mockedPool.execute.mock.calls[0];
    expect(insertSql).toContain('INSERT INTO comments (expense_id, author_id, body) VALUES (?, ?, ?)');
    expect(insertParams).toEqual([7, 3, 'Looks good to me']);

    // Second call: the re-read is scoped to the freshly inserted id.
    const [readSql, readParams] = mockedPool.execute.mock.calls[1];
    expect(readSql).toContain('WHERE c.id = ?');
    expect(readParams).toEqual([42]);

    expect(result).toBe(commentRow);
  });

  it('throws when the row cannot be loaded back after insert', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ insertId: 99 }]) // INSERT
      .mockResolvedValueOnce([[]]); // findById returns nothing

    await expect(
      commentModel.create({ expense_id: 1, author_id: 1, body: 'x' }),
    ).rejects.toThrow('Failed to load comment after insert (id=99)');
  });
});

describe('commentModel.findById', () => {
  it('JOINs users for author display fields and binds the id', async () => {
    mockedPool.execute.mockResolvedValueOnce([[commentRow]]);

    const result = await commentModel.findById(42);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('FROM comments c JOIN users u ON c.author_id = u.id');
    expect(sql).toContain('u.display_name AS author_name');
    expect(sql).toContain('u.role AS author_role');
    expect(sql).toContain('WHERE c.id = ?');
    expect(params).toEqual([42]);
    expect(result).toBe(commentRow);
  });

  it('returns null when no row matches', async () => {
    mockedPool.execute.mockResolvedValueOnce([[]]);
    expect(await commentModel.findById(1)).toBeNull();
  });
});

describe('commentModel.findByExpenseId', () => {
  it('JOINs users, filters by expense and orders created_at ASC, id ASC', async () => {
    const rows = [commentRow];
    mockedPool.execute.mockResolvedValueOnce([rows]);

    const result = await commentModel.findByExpenseId(7);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('FROM comments c JOIN users u ON c.author_id = u.id');
    expect(sql).toContain('WHERE c.expense_id = ?');
    expect(sql).toContain('ORDER BY c.created_at ASC, c.id ASC');
    expect(params).toEqual([7]);
    expect(result).toBe(rows);
  });
});
