import pool from '../../config/db';
import { receiptModel } from '../../models/receipt';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };

const receiptRow = (id: number, expenseId = 7) => ({
  id,
  expense_id: expenseId,
  file_name: `r${id}.pdf`,
  file_path: `/uploads/r${id}.pdf`,
  mime_type: 'application/pdf',
  file_size: 1234,
  uploaded_at: new Date('2026-01-01T00:00:00Z'),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('receiptModel.findByExpenseId', () => {
  it('selects by expense_id ordered oldest-first and returns the rows', async () => {
    const rows = [receiptRow(1), receiptRow(2)];
    mockedPool.execute.mockResolvedValueOnce([rows]);

    const result = await receiptModel.findByExpenseId(7);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('SELECT * FROM receipts WHERE expense_id = ? ORDER BY uploaded_at ASC');
    expect(params).toEqual([7]);
    expect(result).toBe(rows);
  });
});

describe('receiptModel.findById', () => {
  it('binds the id and returns the row', async () => {
    const row = receiptRow(5);
    mockedPool.execute.mockResolvedValueOnce([[row]]);

    const result = await receiptModel.findById(5);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('SELECT * FROM receipts WHERE id = ?');
    expect(params).toEqual([5]);
    expect(result).toBe(row);
  });

  it('returns null when no row matches', async () => {
    mockedPool.execute.mockResolvedValueOnce([[]]);
    expect(await receiptModel.findById(404)).toBeNull();
  });
});

describe('receiptModel.deleteByExpenseId', () => {
  it('fetches rows first, DELETEs by expense_id, and returns the fetched rows for cleanup', async () => {
    const rows = [receiptRow(1), receiptRow(2)];
    mockedPool.execute
      .mockResolvedValueOnce([rows]) // findByExpenseId
      .mockResolvedValueOnce([{ affectedRows: 2 }]); // DELETE

    const result = await receiptModel.deleteByExpenseId(7);

    expect(mockedPool.execute).toHaveBeenCalledTimes(2);

    // First call is the SELECT (fetch for file cleanup).
    const [selectSql, selectParams] = mockedPool.execute.mock.calls[0];
    expect(selectSql).toContain('SELECT * FROM receipts WHERE expense_id = ?');
    expect(selectParams).toEqual([7]);

    // Second call is the DELETE, scoped to the same expense_id.
    const [deleteSql, deleteParams] = mockedPool.execute.mock.calls[1];
    expect(deleteSql).toBe('DELETE FROM receipts WHERE expense_id = ?');
    expect(deleteParams).toEqual([7]);

    // Returns the pre-delete rows so the caller can unlink the files.
    expect(result).toBe(rows);
  });

  it('skips the DELETE entirely when the expense has no receipts', async () => {
    mockedPool.execute.mockResolvedValueOnce([[]]); // findByExpenseId → empty

    const result = await receiptModel.deleteByExpenseId(7);

    // Only the SELECT ran — no DELETE issued.
    expect(mockedPool.execute).toHaveBeenCalledTimes(1);
    const [sql] = mockedPool.execute.mock.calls[0];
    expect(sql).toContain('SELECT * FROM receipts');
    expect(sql).not.toContain('DELETE');
    expect(result).toEqual([]);
  });
});
