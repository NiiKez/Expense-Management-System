import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { Notification, NotificationType } from '../types';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../utils/constants';

interface NotificationRow extends RowDataPacket, Notification {}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const notificationModel = {
  async create(data: {
    user_id: number;
    type: NotificationType;
    expense_id?: number | null;
    actor_id?: number | null;
    message: string;
  }): Promise<Notification> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, type, expense_id, actor_id, message)
       VALUES (?, ?, ?, ?, ?)`,
      [data.user_id, data.type, data.expense_id ?? null, data.actor_id ?? null, data.message],
    );
    const [rows] = await pool.execute<NotificationRow[]>(
      'SELECT * FROM notifications WHERE id = ?',
      [result.insertId],
    );
    return rows[0];
  },

  async findByUserId(
    userId: number,
    options: { unreadOnly?: boolean; page?: number; pageSize?: number } = {},
  ): Promise<{ data: Notification[]; total: number; unread: number }> {
    const page = normalizePositiveInteger(options.page, DEFAULT_PAGE);
    const pageSize = Math.min(normalizePositiveInteger(options.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    let where = 'WHERE user_id = ?';
    const params: (number | string)[] = [userId];
    if (options.unreadOnly) {
      where += ' AND is_read = 0';
    }

    // One scan for both counts instead of two separate COUNT round-trips.
    // SUM(is_read = 0) yields the unread count; under unreadOnly the WHERE already
    // filters to unread rows, so total and unread coincide (as before).
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(is_read = 0), 0) AS unread FROM notifications ${where}`,
      params,
    );
    const total = Number((countRows[0] as { total: number }).total);
    const unread = Number((countRows[0] as { unread: number | string }).unread);

    const [rows] = await pool.query<NotificationRow[]>(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return { data: rows, total, unread };
  },

  async countUnread(userId: number): Promise<number> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId],
    );
    return (rows[0] as { unread: number }).unread;
  },

  // Scoped to the owner so a user can only mark their own notifications read.
  async markRead(id: number, userId: number): Promise<boolean> {
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, userId],
    );
    return result.affectedRows > 0;
  },

  async markAllRead(userId: number): Promise<number> {
    const [result] = await pool.execute<ResultSetHeader>(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [userId],
    );
    return result.affectedRows;
  },
};
