import { RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { AdminStats, CategoryTotal, ManagerStats, MeStats, MonthlyTotal } from '../types';
import { BASE_CURRENCY, sumInBaseSql } from '../utils/fx';

// All money sums are normalized to BASE_CURRENCY so mixed-currency expenses
// aggregate meaningfully. `BASE` targets the unaliased `expenses` table;
// `BASE_E` targets the `e`-aliased table used in the JOIN queries.
const BASE = sumInBaseSql('amount');
const BASE_E = sumInBaseSql('e.amount', 'e.currency');

const MONTHLY_SQL = `
  SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, COALESCE(${BASE},0) AS total
  FROM expenses WHERE deleted_at IS NULL AND {scope}
    AND expense_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
  GROUP BY month ORDER BY month`;

function num(v: unknown): number { return v == null ? 0 : Number(v); }

export const statsModel = {
  async getUserStats(userId: number): Promise<MeStats> {
    const [statusRows] = await pool.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS count, COALESCE(${BASE},0) AS total
       FROM expenses WHERE submitted_by = ? AND deleted_at IS NULL GROUP BY status`, [userId]);
    const totals = { submitted: 0, pending: 0, approved: 0, rejected: 0 };
    for (const r of statusRows) {
      totals.submitted += num(r.count);
      if (r.status === 'PENDING') totals.pending = num(r.count);
      if (r.status === 'APPROVED') totals.approved = num(r.count);
      if (r.status === 'REJECTED') totals.rejected = num(r.count);
    }
    const [monthRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(${BASE},0) AS total FROM expenses
       WHERE submitted_by = ? AND status='APPROVED' AND deleted_at IS NULL
         AND YEAR(expense_date)=YEAR(CURDATE()) AND MONTH(expense_date)=MONTH(CURDATE())`, [userId]);
    const [catRows] = await pool.execute<RowDataPacket[]>(
      `SELECT category, COUNT(*) AS count, COALESCE(${BASE},0) AS total
       FROM expenses WHERE submitted_by = ? AND deleted_at IS NULL GROUP BY category`, [userId]);
    const [monthly] = await pool.execute<RowDataPacket[]>(
      MONTHLY_SQL.replace('{scope}', 'submitted_by = ?'), [userId]);
    return {
      totals,
      approvedAmountMonth: num(monthRows[0]?.total),
      baseCurrency: BASE_CURRENCY,
      byCategory: catRows.map((r) => ({ category: r.category, count: num(r.count), total: num(r.total) })) as CategoryTotal[],
      monthly: monthly.map((r) => ({ month: r.month, total: num(r.total) })) as MonthlyTotal[],
    };
  },

  async getTeamStats(managerId: number): Promise<ManagerStats> {
    const [[size]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM users WHERE manager_id = ? AND is_active = 1`, [managerId]) as unknown as [RowDataPacket[]];
    const [[pending]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM expenses e JOIN users u ON e.submitted_by = u.id
       WHERE u.manager_id = ? AND e.status='PENDING' AND e.deleted_at IS NULL`, [managerId]) as unknown as [RowDataPacket[]];
    const [[teamMonth]] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(${BASE_E},0) AS t FROM expenses e JOIN users u ON e.submitted_by=u.id
       WHERE u.manager_id = ? AND e.deleted_at IS NULL
         AND YEAR(e.expense_date)=YEAR(CURDATE()) AND MONTH(e.expense_date)=MONTH(CURDATE())`, [managerId]) as unknown as [RowDataPacket[]];
    const [[appMonth]] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(${BASE_E},0) AS t FROM expenses e JOIN users u ON e.submitted_by=u.id
       WHERE u.manager_id = ? AND e.status='APPROVED' AND e.deleted_at IS NULL
         AND YEAR(e.expense_date)=YEAR(CURDATE()) AND MONTH(e.expense_date)=MONTH(CURDATE())`, [managerId]) as unknown as [RowDataPacket[]];
    const [catRows] = await pool.execute<RowDataPacket[]>(
      `SELECT e.category, COUNT(*) AS count, COALESCE(${BASE_E},0) AS total
       FROM expenses e JOIN users u ON e.submitted_by=u.id
       WHERE u.manager_id = ? AND e.deleted_at IS NULL GROUP BY e.category`, [managerId]);
    const [monthly] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(e.expense_date,'%Y-%m') AS month, COALESCE(${BASE_E},0) AS total
       FROM expenses e JOIN users u ON e.submitted_by=u.id
       WHERE e.deleted_at IS NULL AND u.manager_id = ?
         AND e.expense_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH),'%Y-%m-01')
       GROUP BY month ORDER BY month`, [managerId]);
    return {
      pendingApprovals: num(pending.c), teamSize: num(size.c),
      teamSpendMonth: num(teamMonth.t), approvedMonth: num(appMonth.t),
      baseCurrency: BASE_CURRENCY,
      byCategory: catRows.map((r) => ({ category: r.category, count: num(r.count), total: num(r.total) })) as CategoryTotal[],
      monthly: monthly.map((r) => ({ month: r.month, total: num(r.total) })) as MonthlyTotal[],
    };
  },

  async getOrgStats(): Promise<AdminStats> {
    const [[org]] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(${BASE},0) AS t FROM expenses WHERE deleted_at IS NULL
         AND YEAR(expense_date)=YEAR(CURDATE()) AND MONTH(expense_date)=MONTH(CURDATE())`) as unknown as [RowDataPacket[]];
    const [[pending]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM expenses WHERE status='PENDING' AND deleted_at IS NULL`) as unknown as [RowDataPacket[]];
    const [[users]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM users WHERE is_active = 1`) as unknown as [RowDataPacket[]];
    const [[appMonth]] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(${BASE},0) AS t FROM expenses WHERE status='APPROVED' AND deleted_at IS NULL
         AND YEAR(expense_date)=YEAR(CURDATE()) AND MONTH(expense_date)=MONTH(CURDATE())`) as unknown as [RowDataPacket[]];
    const [catRows] = await pool.execute<RowDataPacket[]>(
      `SELECT category, COUNT(*) AS count, COALESCE(${BASE},0) AS total
       FROM expenses WHERE deleted_at IS NULL GROUP BY category`);
    const [monthly] = await pool.execute<RowDataPacket[]>(
      MONTHLY_SQL.replace('AND {scope}', ''));
    return {
      orgSpendMonth: num(org.t), pendingOrgWide: num(pending.c), activeUsers: num(users.c),
      approvedMonth: num(appMonth.t),
      baseCurrency: BASE_CURRENCY,
      byCategory: catRows.map((r) => ({ category: r.category, count: num(r.count), total: num(r.total) })) as CategoryTotal[],
      monthly: monthly.map((r) => ({ month: r.month, total: num(r.total) })) as MonthlyTotal[],
    };
  },
};
