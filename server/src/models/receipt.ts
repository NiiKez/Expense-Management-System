import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { Receipt } from '../types';

interface ReceiptRow extends RowDataPacket, Receipt {}

export const receiptModel = {
  async create(data: {
    expense_id: number;
    file_name: string;
    file_path: string;
    mime_type: string;
    file_size: number;
  }): Promise<Receipt> {
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO receipts (expense_id, file_name, file_path, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?)`,
      [data.expense_id, data.file_name, data.file_path, data.mime_type, data.file_size],
    );

    const [rows] = await pool.execute<ReceiptRow[]>(
      'SELECT * FROM receipts WHERE id = ?',
      [result.insertId],
    );
    return rows[0];
  },

  async findByExpenseId(expenseId: number): Promise<Receipt[]> {
    const [rows] = await pool.execute<ReceiptRow[]>(
      'SELECT * FROM receipts WHERE expense_id = ? ORDER BY uploaded_at ASC',
      [expenseId],
    );
    return rows;
  },

  async findById(id: number): Promise<Receipt | null> {
    const [rows] = await pool.execute<ReceiptRow[]>(
      'SELECT * FROM receipts WHERE id = ?',
      [id],
    );
    return rows[0] || null;
  },

  async deleteByExpenseId(expenseId: number): Promise<Receipt[]> {
    // Fetch receipts first so callers can clean up files
    const receipts = await this.findByExpenseId(expenseId);
    if (receipts.length > 0) {
      await pool.execute('DELETE FROM receipts WHERE expense_id = ?', [expenseId]);
    }
    return receipts;
  },
};
