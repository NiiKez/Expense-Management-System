import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { Expense, Receipt, Status } from '../types';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, EXPORT_MAX_ROWS } from '../utils/constants';
import { resolveSort } from '../utils/sorting';

// Public sort key -> trusted SQL column. Used to build a safe ORDER BY.
// Unaliased columns target the bare `expenses` table (findByUserId); the
// `e.`/`u.`-prefixed variants target the JOIN query (findAll).
const USER_EXPENSE_SORTS: Record<string, string> = {
  title: 'title',
  category: 'category',
  amount: 'amount',
  date: 'expense_date',
  status: 'status',
  created: 'created_at',
};
const ADMIN_EXPENSE_SORTS: Record<string, string> = {
  title: 'e.title',
  submitter: 'u.display_name',
  category: 'e.category',
  amount: 'e.amount',
  date: 'e.expense_date',
  status: 'e.status',
  created: 'e.created_at',
};

interface ExpenseRow extends RowDataPacket, Expense {}
interface ReceiptRow extends RowDataPacket, Receipt {}
interface StoredProcedureResultRow extends RowDataPacket {
  result_code: 'SUCCESS' | 'NOT_FOUND' | 'NOT_PENDING' | 'VERSION_CONFLICT' | 'SAME_STATUS';
}

const UPDATE_FIELDS = new Set([
  'title',
  'description',
  'amount',
  'currency',
  'category',
  'expense_date',
]);

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// Escape LIKE wildcards so user input "50%" doesn't become a wildcard pattern.
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const expenseModel = {
  // Submit an expense atomically: the expense row, its optional receipt, and the
  // immutable SUBMITTED audit entry all commit together or not at all. The old
  // flow inserted these on three separate pooled connections, so a failure after
  // the expense committed could leave a submitted expense with no audit row (an
  // incomplete, non-compliant audit trail) or an orphaned receipt.
  async createSubmission(params: {
    expense: {
      submitted_by: number;
      title: string;
      description?: string | null;
      amount: number;
      currency: string;
      category: string;
      expense_date: string;
    };
    receipt?: {
      file_name: string;
      file_path: string;
      mime_type: string;
      file_size: number;
    } | null;
    ipAddress: string | null;
  }): Promise<{ expense: Expense; receipt: Receipt | null }> {
    const { expense: data, receipt: receiptData, ipAddress } = params;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [insertResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO expenses (submitted_by, title, description, amount, currency, category, expense_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.submitted_by,
          data.title,
          data.description ?? null,
          data.amount,
          data.currency,
          data.category,
          data.expense_date,
        ],
      );
      const expenseId = insertResult.insertId;

      let receipt: Receipt | null = null;
      if (receiptData) {
        const [receiptResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO receipts (expense_id, file_name, file_path, mime_type, file_size)
           VALUES (?, ?, ?, ?, ?)`,
          [expenseId, receiptData.file_name, receiptData.file_path, receiptData.mime_type, receiptData.file_size],
        );
        const [receiptRows] = await conn.execute<ReceiptRow[]>(
          'SELECT * FROM receipts WHERE id = ?',
          [receiptResult.insertId],
        );
        receipt = receiptRows[0] || null;
      }

      await conn.execute<ResultSetHeader>(
        `INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
         VALUES (?, 'SUBMITTED', ?, NULL, 'PENDING', NULL, ?)`,
        [expenseId, data.submitted_by, ipAddress],
      );

      // Re-read on the same connection before commit so the returned row reflects
      // exactly what this transaction wrote (mirrors resubmit()).
      const [expenseRows] = await conn.execute<ExpenseRow[]>(
        'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
        [expenseId],
      );

      // Validate the re-read *before* committing: a throw here rolls back the
      // still-open transaction cleanly, instead of throwing after commit and
      // rolling back an already-durable write (which would 500 on data that
      // was actually persisted).
      const expense = expenseRows[0];
      if (!expense) {
        throw new Error(`Failed to load expense after insert (id=${expenseId})`);
      }

      await conn.commit();

      return { expense, receipt };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findById(id: number): Promise<Expense | null> {
    const [rows] = await pool.execute<ExpenseRow[]>(
      'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return rows[0] || null;
  },

  async findByUserId(
    userId: number,
    options: {
      status?: Status;
      category?: string;
      search?: string;
      date_from?: string;
      date_to?: string;
      sort?: string;
      order?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{ data: Expense[]; total: number }> {
    const page = normalizePositiveInteger(options.page, DEFAULT_PAGE);
    const pageSize = Math.min(normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    let whereClause = 'WHERE submitted_by = ? AND deleted_at IS NULL';
    const params: (number | string)[] = [userId];

    if (options.status) {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }
    if (options.category) {
      whereClause += ' AND category = ?';
      params.push(options.category);
    }
    if (options.search) {
      whereClause += " AND title LIKE ? ESCAPE '\\\\'";
      params.push(`%${escapeLike(options.search)}%`);
    }
    if (options.date_from) {
      whereClause += ' AND expense_date >= ?';
      params.push(options.date_from);
    }
    if (options.date_to) {
      whereClause += ' AND expense_date <= ?';
      params.push(options.date_to);
    }

    const { columnSql, direction } = resolveSort(options.sort, options.order, USER_EXPENSE_SORTS, {
      columnSql: 'created_at',
      direction: 'DESC',
    });

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM expenses ${whereClause}`,
      params,
    );
    const total = (countRows[0] as { total: number }).total;

    const [rows] = await pool.query<ExpenseRow[]>(
      `SELECT * FROM expenses ${whereClause} ORDER BY ${columnSql} ${direction}, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return { data: rows, total };
  },

  // Like findByUserId but unpaginated (capped at EXPORT_MAX_ROWS) for CSV export.
  async findByUserIdForExport(
    userId: number,
    options: {
      status?: Status;
      category?: string;
      search?: string;
      date_from?: string;
      date_to?: string;
      sort?: string;
      order?: string;
    } = {},
  ): Promise<{ data: Expense[]; capped: boolean }> {
    let whereClause = 'WHERE submitted_by = ? AND deleted_at IS NULL';
    const params: (number | string)[] = [userId];

    if (options.status) {
      whereClause += ' AND status = ?';
      params.push(options.status);
    }
    if (options.category) {
      whereClause += ' AND category = ?';
      params.push(options.category);
    }
    if (options.search) {
      whereClause += " AND title LIKE ? ESCAPE '\\\\'";
      params.push(`%${escapeLike(options.search)}%`);
    }
    if (options.date_from) {
      whereClause += ' AND expense_date >= ?';
      params.push(options.date_from);
    }
    if (options.date_to) {
      whereClause += ' AND expense_date <= ?';
      params.push(options.date_to);
    }

    const { columnSql, direction } = resolveSort(options.sort, options.order, USER_EXPENSE_SORTS, {
      columnSql: 'created_at',
      direction: 'DESC',
    });

    const [rows] = await pool.query<ExpenseRow[]>(
      `SELECT * FROM expenses ${whereClause} ORDER BY ${columnSql} ${direction}, id DESC LIMIT ?`,
      [...params, EXPORT_MAX_ROWS + 1],
    );

    const capped = rows.length > EXPORT_MAX_ROWS;
    return { data: capped ? rows.slice(0, EXPORT_MAX_ROWS) : rows, capped };
  },

  async update(
    id: number,
    data: Partial<{
      title: string;
      description: string | null;
      amount: number;
      currency: string;
      category: string;
      expense_date: string;
    }>,
    currentVersion: number,
  ): Promise<{ expense: Expense | null; appliedFields: string[] }> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    const appliedFields: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && UPDATE_FIELDS.has(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
        appliedFields.push(key);
      }
    }

    if (fields.length === 0) {
      const expense = await this.findById(id);
      return { expense, appliedFields: [] };
    }

    // Optimistic concurrency: bump version
    fields.push('version = version + 1');

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE expenses
       SET ${fields.join(', ')}
       WHERE id = ? AND version = ? AND status = 'PENDING' AND deleted_at IS NULL`,
      [...values, id, currentVersion],
    );

    if (result.affectedRows === 0) return { expense: null, appliedFields };

    const expense = await this.findById(id);
    return { expense, appliedFields };
  },

  // Resubmit a REJECTED expense: apply any edited fields, then transition back to
  // PENDING and clear the prior rejection (reason + approver). Optimistic-locked
  // on version, mirroring update()/delete().
  async resubmit(
    id: number,
    data: Partial<{
      title: string;
      description: string | null;
      amount: number;
      currency: string;
      category: string;
      expense_date: string;
    }>,
    expectedVersion: number,
  ): Promise<{
    result: 'SUCCESS' | 'CONFLICT' | 'NOT_FOUND' | 'NOT_REJECTED';
    expense: Expense | null;
    appliedFields: string[];
  }> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute<ExpenseRow[]>(
        'SELECT id, version, status FROM expenses WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      if (rows.length === 0) {
        await conn.rollback();
        return { result: 'NOT_FOUND', expense: null, appliedFields: [] };
      }

      const row = rows[0];
      if (row.status !== 'REJECTED') {
        await conn.rollback();
        return { result: 'NOT_REJECTED', expense: null, appliedFields: [] };
      }
      if (row.version !== expectedVersion) {
        await conn.rollback();
        return { result: 'CONFLICT', expense: null, appliedFields: [] };
      }

      const fields: string[] = [];
      const values: (string | number | null)[] = [];
      const appliedFields: string[] = [];
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && UPDATE_FIELDS.has(key)) {
          fields.push(`${key} = ?`);
          values.push(value);
          appliedFields.push(key);
        }
      }

      const setClauses = [
        ...fields,
        "status = 'PENDING'",
        'rejection_reason = NULL',
        'approved_by = NULL',
        'version = version + 1',
      ];

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE expenses SET ${setClauses.join(', ')}
         WHERE id = ? AND version = ? AND status = 'REJECTED' AND deleted_at IS NULL`,
        [...values, id, expectedVersion],
      );
      if (result.affectedRows === 0) {
        await conn.rollback();
        return { result: 'CONFLICT', expense: null, appliedFields };
      }

      // Re-read on the same connection *before* commit so the returned row is the
      // one this transaction just wrote. Reading via the pool after commit could
      // land on a lagging replica/proxy and return a stale (or missing) row.
      const [updatedRows] = await conn.execute<ExpenseRow[]>(
        'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
        [id],
      );

      await conn.commit();
      return { result: 'SUCCESS', expense: updatedRows[0] || null, appliedFields };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  // Returns 'SUCCESS' on delete, 'CONFLICT' on optimistic-version mismatch, 'NOT_FOUND' otherwise.
  // Why: callers need to surface 409 vs 404, and the version check guards against
  // a concurrent UPDATE losing data when delete runs against a stale view.
  async delete(
    id: number,
    deletedBy: number,
    expectedVersion: number,
    ipAddress: string | null,
  ): Promise<'SUCCESS' | 'CONFLICT' | 'NOT_FOUND'> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [expenseRows] = await conn.execute<ExpenseRow[]>(
        'SELECT id, version, status FROM expenses WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [id],
      );

      if (expenseRows.length === 0) {
        await conn.rollback();
        return 'NOT_FOUND';
      }

      const row = expenseRows[0];
      if (row.status !== 'PENDING' || row.version !== expectedVersion) {
        await conn.rollback();
        return 'CONFLICT';
      }

      await conn.execute<ResultSetHeader>(
        `INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
         SELECT id, 'DELETED', ?, status, NULL, JSON_OBJECT('title', title, 'amount', amount), ?
         FROM expenses
         WHERE id = ?`,
        [deletedBy, ipAddress, id],
      );

      const [result] = await conn.execute<ResultSetHeader>(
        `UPDATE expenses
         SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, version = version + 1
         WHERE id = ? AND version = ? AND status = 'PENDING' AND deleted_at IS NULL`,
        [deletedBy, id, expectedVersion],
      );

      if (result.affectedRows === 0) {
        await conn.rollback();
        return 'CONFLICT';
      }

      await conn.commit();
      return 'SUCCESS';
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findAll(
    options: {
      status?: Status;
      category?: string;
      search?: string;
      date_from?: string;
      date_to?: string;
      sort?: string;
      order?: string;
      page?: number;
      pageSize?: number;
      // When set, restrict the ledger to one demo workspace (a demo admin must
      // never see real or other demo workspaces' expenses). The query already
      // joins users, so this filters on the submitter's demo session.
      demoSessionId?: string;
    } = {},
  ): Promise<{ data: Expense[]; total: number }> {
    const page = normalizePositiveInteger(options.page, DEFAULT_PAGE);
    const pageSize = Math.min(normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['e.deleted_at IS NULL'];
    const params: (string | number)[] = [];

    if (options.demoSessionId) {
      conditions.push('u.is_demo = TRUE AND u.demo_session_id = ?');
      params.push(options.demoSessionId);
    }
    if (options.status) {
      conditions.push('e.status = ?');
      params.push(options.status);
    }
    if (options.category) {
      conditions.push('e.category = ?');
      params.push(options.category);
    }
    if (options.search) {
      const escaped = `%${escapeLike(options.search)}%`;
      conditions.push("(e.title LIKE ? ESCAPE '\\\\' OR u.display_name LIKE ? ESCAPE '\\\\')");
      params.push(escaped, escaped);
    }
    if (options.date_from) {
      conditions.push('e.expense_date >= ?');
      params.push(options.date_from);
    }
    if (options.date_to) {
      conditions.push('e.expense_date <= ?');
      params.push(options.date_to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { columnSql, direction } = resolveSort(options.sort, options.order, ADMIN_EXPENSE_SORTS, {
      columnSql: 'e.created_at',
      direction: 'DESC',
    });

    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM expenses e
       JOIN users u ON e.submitted_by = u.id
       ${whereClause}`,
      params,
    );
    const total = (countRows[0] as { total: number }).total;

    const [rows] = await pool.query<ExpenseRow[]>(
      `SELECT e.*, u.display_name as submitter_name, u.email as submitter_email
       FROM expenses e
       JOIN users u ON e.submitted_by = u.id
       ${whereClause}
       ORDER BY ${columnSql} ${direction}, e.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return { data: rows, total };
  },

  // Like findAll but unpaginated (capped at EXPORT_MAX_ROWS) for CSV export.
  async findAllForExport(
    options: {
      status?: Status;
      category?: string;
      search?: string;
      date_from?: string;
      date_to?: string;
      sort?: string;
      order?: string;
    } = {},
  ): Promise<{ data: Expense[]; capped: boolean }> {
    const conditions: string[] = ['e.deleted_at IS NULL'];
    const params: (string | number)[] = [];

    if (options.status) {
      conditions.push('e.status = ?');
      params.push(options.status);
    }
    if (options.category) {
      conditions.push('e.category = ?');
      params.push(options.category);
    }
    if (options.search) {
      const escaped = `%${escapeLike(options.search)}%`;
      conditions.push("(e.title LIKE ? ESCAPE '\\\\' OR u.display_name LIKE ? ESCAPE '\\\\')");
      params.push(escaped, escaped);
    }
    if (options.date_from) {
      conditions.push('e.expense_date >= ?');
      params.push(options.date_from);
    }
    if (options.date_to) {
      conditions.push('e.expense_date <= ?');
      params.push(options.date_to);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const { columnSql, direction } = resolveSort(options.sort, options.order, ADMIN_EXPENSE_SORTS, {
      columnSql: 'e.created_at',
      direction: 'DESC',
    });

    const [rows] = await pool.query<ExpenseRow[]>(
      `SELECT e.*, u.display_name as submitter_name, u.email as submitter_email
       FROM expenses e
       JOIN users u ON e.submitted_by = u.id
       ${whereClause}
       ORDER BY ${columnSql} ${direction}, e.id DESC
       LIMIT ?`,
      [...params, EXPORT_MAX_ROWS + 1],
    );

    const capped = rows.length > EXPORT_MAX_ROWS;
    return { data: capped ? rows.slice(0, EXPORT_MAX_ROWS) : rows, capped };
  },

  async findPendingByManagerId(
    managerId: number,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ data: Expense[]; total: number }> {
    const page = normalizePositiveInteger(options.page, DEFAULT_PAGE);
    const pageSize = Math.min(normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    // Pending expenses submitted by this manager's direct reports
    // (manager_id match). Excludes the manager's own expenses.
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM expenses e
       JOIN users u ON e.submitted_by = u.id
       WHERE e.status = 'PENDING'
         AND e.deleted_at IS NULL
         AND e.submitted_by != ?
         AND u.manager_id = ?`,
      [managerId, managerId],
    );
    const total = (countRows[0] as { total: number }).total;

    const [rows] = await pool.query<ExpenseRow[]>(
      `SELECT e.*, u.display_name as submitter_name, u.email as submitter_email
       FROM expenses e
       JOIN users u ON e.submitted_by = u.id
       WHERE e.status = 'PENDING'
         AND e.deleted_at IS NULL
         AND e.submitted_by != ?
         AND u.manager_id = ?
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [managerId, managerId, pageSize, offset],
    );

    return { data: rows, total };
  },

  async findPendingBySubmitterIds(
    submitterIds: number[],
    options: { page?: number; pageSize?: number } = {},
  ): Promise<{ data: Expense[]; total: number }> {
    if (submitterIds.length === 0) {
      return { data: [], total: 0 };
    }

    const page = normalizePositiveInteger(options.page, DEFAULT_PAGE);
    const pageSize = Math.min(normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const placeholders = submitterIds.map(() => '?').join(', ');

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM expenses
       WHERE status = 'PENDING'
         AND deleted_at IS NULL
         AND submitted_by IN (${placeholders})`,
      submitterIds,
    );
    const total = (countRows[0] as { total: number }).total;

    const [rows] = await pool.query<ExpenseRow[]>(
      `SELECT e.*, u.display_name as submitter_name, u.email as submitter_email
       FROM expenses e
       JOIN users u ON e.submitted_by = u.id
       WHERE e.status = 'PENDING'
         AND e.deleted_at IS NULL
         AND e.submitted_by IN (${placeholders})
       ORDER BY e.created_at DESC
       LIMIT ? OFFSET ?`,
      [...submitterIds, pageSize, offset],
    );

    return { data: rows, total };
  },

  async approveWithVersion(
    expenseId: number,
    approvedBy: number,
    version: number,
    ipAddress: string | null,
  ): Promise<StoredProcedureResultRow['result_code']> {
    // mysql2 returns SP results as [rowsArray, ..., okPacket]; the first element is the SELECT rows.
    const [resultSets] = await pool.query(
      'CALL sp_approve_expense(?, ?, ?, ?)',
      [expenseId, approvedBy, version, ipAddress],
    ) as unknown as [StoredProcedureResultRow[][], unknown];

    const firstRowSet = resultSets[0];
    return firstRowSet?.[0]?.result_code ?? 'NOT_FOUND';
  },

  async rejectWithVersion(
    expenseId: number,
    rejectedBy: number,
    version: number,
    reason: string,
    ipAddress: string | null,
  ): Promise<StoredProcedureResultRow['result_code']> {
    const [resultSets] = await pool.query(
      'CALL sp_reject_expense(?, ?, ?, ?, ?)',
      [expenseId, rejectedBy, version, reason, ipAddress],
    ) as unknown as [StoredProcedureResultRow[][], unknown];

    const firstRowSet = resultSets[0];
    return firstRowSet?.[0]?.result_code ?? 'NOT_FOUND';
  },
};
