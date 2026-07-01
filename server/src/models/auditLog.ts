import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { AuditLog, AuditAction, Status } from '../types';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, EXPORT_MAX_ROWS } from '../utils/constants';
import { resolveSort } from '../utils/sorting';

interface AuditLogRow extends RowDataPacket, AuditLog {}
export interface AuditLogExportRow extends AuditLog {
  performer_name: string | null;
}
interface AuditLogExportRowPacket extends RowDataPacket, AuditLogExportRow {}

// Public sort key -> trusted SQL column for the admin audit log view.
const AUDIT_LOG_SORTS: Record<string, string> = {
  expense: 'expense_id',
  action: 'action',
  actor: 'performed_by',
  when: 'created_at',
};

// Export joins users, so columns must be table-qualified to avoid ambiguity
// (both audit_logs and users have a created_at column).
const AUDIT_LOG_EXPORT_SORTS: Record<string, string> = {
  expense: 'a.expense_id',
  action: 'a.action',
  actor: 'a.performed_by',
  when: 'a.created_at',
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

export const auditLogModel = {
  async create(data: {
    expense_id: number;
    action: AuditAction;
    performed_by: number;
    old_status?: Status | null;
    new_status?: Status | null;
    details?: Record<string, unknown> | null;
    ip_address?: string | null;
  }): Promise<AuditLog> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO audit_logs (expense_id, action, performed_by, old_status, new_status, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.expense_id,
        data.action,
        data.performed_by,
        data.old_status ?? null,
        data.new_status ?? null,
        data.details ? JSON.stringify(data.details) : null,
        data.ip_address ?? null,
      ],
    );

    const [rows] = await pool.execute<AuditLogRow[]>(
      'SELECT * FROM audit_logs WHERE id = ?',
      [result.insertId],
    );
    return rows[0];
  },

  async findByExpenseId(expenseId: number): Promise<AuditLog[]> {
    const [rows] = await pool.execute<AuditLogRow[]>(
      'SELECT * FROM audit_logs WHERE expense_id = ? ORDER BY created_at ASC',
      [expenseId],
    );
    return rows;
  },

  async findAll(filters: {
    expense_id?: number;
    performed_by?: number;
    action?: AuditAction;
    date_from?: string;
    date_to?: string;
    sort?: string;
    order?: string;
    page?: number;
    pageSize?: number;
    // When set, restrict the trail to one demo workspace (a demo admin must
    // never see real or other demo workspaces' audit history). Every audit row
    // is performed by a workspace user, so filter on the performer's session.
    demoSessionId?: string;
  }): Promise<{ data: AuditLog[]; total: number }> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.demoSessionId) {
      conditions.push(
        'performed_by IN (SELECT id FROM users WHERE is_demo = TRUE AND demo_session_id = ?)',
      );
      params.push(filters.demoSessionId);
    } else {
      // Real admin: exclude demo-performed rows so the org audit trail isn't
      // polluted with seeded demo activity (performed_by is NOT NULL, so every
      // audit row maps to exactly one user and this can't drop system rows).
      conditions.push('performed_by IN (SELECT id FROM users WHERE is_demo = FALSE)');
    }
    if (filters.expense_id !== undefined) {
      conditions.push('expense_id = ?');
      params.push(filters.expense_id);
    }
    if (filters.performed_by !== undefined) {
      conditions.push('performed_by = ?');
      params.push(filters.performed_by);
    }
    if (filters.action !== undefined) {
      conditions.push('action = ?');
      params.push(filters.action);
    }
    if (filters.date_from) {
      conditions.push('created_at >= ?');
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push('created_at <= ?');
      params.push(filters.date_to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countParams = [...params];
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
      countParams,
    );
    const total = (countRows[0] as { total: number }).total;

    const page = normalizePositiveInteger(filters.page, DEFAULT_PAGE);
    const pageSize = Math.min(normalizePositiveInteger(filters.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const { columnSql, direction } = resolveSort(filters.sort, filters.order, AUDIT_LOG_SORTS, {
      columnSql: 'created_at',
      direction: 'DESC',
    });

    const dataParams: (string | number)[] = [...params, pageSize, offset];
    const [rows] = await pool.query<AuditLogRow[]>(
      `SELECT * FROM audit_logs ${where} ORDER BY ${columnSql} ${direction}, id DESC LIMIT ? OFFSET ?`,
      dataParams,
    );

    return { data: rows, total };
  },

  // Like findAll but unpaginated (capped at EXPORT_MAX_ROWS) and with the
  // performer's display name joined in, for CSV export.
  async findAllForExport(filters: {
    expense_id?: number;
    performed_by?: number;
    action?: AuditAction;
    date_from?: string;
    date_to?: string;
    sort?: string;
    order?: string;
    // Same demo semantics as findAll: a real admin exports only real activity; a
    // (denyDemo-blocked, defense-in-depth) demo caller would get only its own
    // workspace's trail.
    demoSessionId?: string;
  }): Promise<{ data: AuditLogExportRow[]; capped: boolean }> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.demoSessionId) {
      conditions.push('u.is_demo = TRUE AND u.demo_session_id = ?');
      params.push(filters.demoSessionId);
    } else {
      conditions.push('u.is_demo = FALSE');
    }
    if (filters.expense_id !== undefined) {
      conditions.push('a.expense_id = ?');
      params.push(filters.expense_id);
    }
    if (filters.performed_by !== undefined) {
      conditions.push('a.performed_by = ?');
      params.push(filters.performed_by);
    }
    if (filters.action !== undefined) {
      conditions.push('a.action = ?');
      params.push(filters.action);
    }
    if (filters.date_from) {
      conditions.push('a.created_at >= ?');
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push('a.created_at <= ?');
      params.push(filters.date_to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { columnSql, direction } = resolveSort(filters.sort, filters.order, AUDIT_LOG_EXPORT_SORTS, {
      columnSql: 'a.created_at',
      direction: 'DESC',
    });

    const [rows] = await pool.query<AuditLogExportRowPacket[]>(
      `SELECT a.*, u.display_name AS performer_name
       FROM audit_logs a JOIN users u ON a.performed_by = u.id
       ${where}
       ORDER BY ${columnSql} ${direction}, a.id DESC
       LIMIT ?`,
      [...params, EXPORT_MAX_ROWS + 1],
    );

    const capped = rows.length > EXPORT_MAX_ROWS;
    return { data: capped ? rows.slice(0, EXPORT_MAX_ROWS) : rows, capped };
  },
};
