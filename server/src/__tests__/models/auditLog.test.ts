import pool from '../../config/db';
import { auditLogModel } from '../../models/auditLog';
import { AppError } from '../../utils/errors';
import { AuditAction, Status } from '../../types';

// Unit tests with the mysql2 pool fully mocked (no DB). They pin the exact SQL
// and bound params so a regression that string-interpolates SQL, drops the
// ORDER BY allowlist, or stops JSON-stringifying `details` fails immediately.

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { execute: jest.fn(), query: jest.fn(), getConnection: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedPool = pool as unknown as { execute: jest.Mock; query: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  mockedPool.execute.mockResolvedValue([[{ total: 0 }]]);
  mockedPool.query.mockResolvedValue([[]]);
});

// ─────────────────────────────────────────────────────────────────────────────
// create(): JSON-stringifies `details`, then re-reads the row by insertId.
// ─────────────────────────────────────────────────────────────────────────────

describe('auditLogModel.create', () => {
  it('inserts with details JSON-stringified and re-reads by insertId', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ insertId: 42 }]) // INSERT
      .mockResolvedValueOnce([[{ id: 42, action: 'SUBMITTED' }]]); // SELECT re-read

    const row = await auditLogModel.create({
      expense_id: 5,
      action: AuditAction.SUBMITTED,
      performed_by: 7,
      old_status: null,
      new_status: Status.PENDING,
      details: { title: 'Lunch', amount: 12.5 },
      ip_address: '10.0.0.1',
    });

    const [insertSql, insertParams] = mockedPool.execute.mock.calls[0];
    expect(insertSql).toContain('INSERT INTO audit_logs');
    expect(insertSql).toContain('VALUES (?, ?, ?, ?, ?, ?, ?)');
    // details is serialized to a JSON string (index 5), not passed as an object.
    expect(insertParams).toEqual([
      5,
      'SUBMITTED',
      7,
      null,
      'PENDING',
      '{"title":"Lunch","amount":12.5}',
      '10.0.0.1',
    ]);

    const [selectSql, selectParams] = mockedPool.execute.mock.calls[1];
    expect(selectSql).toBe('SELECT * FROM audit_logs WHERE id = ?');
    expect(selectParams).toEqual([42]);
    expect(row).toEqual({ id: 42, action: 'SUBMITTED' });
  });

  it('binds NULL (not the string "null") when details/optional fields are omitted', async () => {
    mockedPool.execute
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1 }]]);

    await auditLogModel.create({ expense_id: 5, action: AuditAction.DELETED, performed_by: 7 });

    const [, insertParams] = mockedPool.execute.mock.calls[0];
    expect(insertParams).toEqual([5, 'DELETED', 7, null, null, null, null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByExpenseId(): fixed ordering + parameter binding.
// ─────────────────────────────────────────────────────────────────────────────

describe('auditLogModel.findByExpenseId', () => {
  it('selects by expense_id ordered chronologically, binding the id', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockedPool.execute.mockResolvedValue([rows]);

    const result = await auditLogModel.findByExpenseId(5);

    const [sql, params] = mockedPool.execute.mock.calls[0];
    expect(sql).toBe('SELECT * FROM audit_logs WHERE expense_id = ? ORDER BY created_at ASC');
    expect(params).toEqual([5]);
    expect(result).toBe(rows);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [CRITICAL] ORDER BY allowlist wiring in findAll / findAllForExport.
// ─────────────────────────────────────────────────────────────────────────────

describe('auditLogModel.findAll — ORDER BY allowlist wiring', () => {
  it('maps the public key actor -> performed_by in the DATA query', async () => {
    await auditLogModel.findAll({ sort: 'actor', order: 'asc' });

    const [dataSql] = mockedPool.query.mock.calls[0];
    expect(dataSql).toContain('ORDER BY performed_by ASC, id DESC');
    expect(dataSql).not.toContain('ORDER BY actor');
  });

  it('maps when -> created_at (not the raw key)', async () => {
    await auditLogModel.findAll({ sort: 'when', order: 'desc' });
    const [dataSql] = mockedPool.query.mock.calls[0];
    expect(dataSql).toContain('ORDER BY created_at DESC, id DESC');
  });

  it('rejects an unknown/injecting sort key with a 400 and never runs the data query', async () => {
    await expect(
      auditLogModel.findAll({ sort: 'performed_by; DROP TABLE audit_logs' }),
    ).rejects.toBeInstanceOf(AppError);

    // The count query runs before resolveSort, but the data (ORDER BY) query must
    // never be reached with an interpolated value.
    expect(mockedPool.query).not.toHaveBeenCalled();

    await auditLogModel
      .findAll({ sort: 'evil' })
      .catch((err: AppError) => {
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('Invalid sort field');
      });
  });
});

describe('auditLogModel.findAllForExport — ORDER BY allowlist wiring', () => {
  it('maps the export key actor -> a.performed_by (table-qualified)', async () => {
    await auditLogModel.findAllForExport({ sort: 'actor', order: 'asc' });
    const [sql] = mockedPool.query.mock.calls[0];
    expect(sql).toContain('ORDER BY a.performed_by ASC, a.id DESC');
  });

  it('rejects an unknown sort key with a 400 and issues NO query', async () => {
    await expect(
      auditLogModel.findAllForExport({ sort: 'a.performed_by--' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockedPool.query).not.toHaveBeenCalled();
  });
});
