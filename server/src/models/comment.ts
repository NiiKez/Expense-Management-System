import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { Comment } from '../types';

interface CommentRow extends RowDataPacket, Comment {}

export const commentModel = {
  async create(data: { expense_id: number; author_id: number; body: string }): Promise<Comment> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO comments (expense_id, author_id, body) VALUES (?, ?, ?)`,
      [data.expense_id, data.author_id, data.body],
    );
    const created = await this.findById(result.insertId);
    if (!created) {
      throw new Error(`Failed to load comment after insert (id=${result.insertId})`);
    }
    return created;
  },

  async findById(id: number): Promise<Comment | null> {
    const [rows] = await pool.execute<CommentRow[]>(
      `SELECT c.*, u.display_name AS author_name, u.role AS author_role
       FROM comments c JOIN users u ON c.author_id = u.id
       WHERE c.id = ?`,
      [id],
    );
    return rows[0] || null;
  },

  async findByExpenseId(expenseId: number): Promise<Comment[]> {
    const [rows] = await pool.execute<CommentRow[]>(
      `SELECT c.*, u.display_name AS author_name, u.role AS author_role
       FROM comments c JOIN users u ON c.author_id = u.id
       WHERE c.expense_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
      [expenseId],
    );
    return rows;
  },
};
