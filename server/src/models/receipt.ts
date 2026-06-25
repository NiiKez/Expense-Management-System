import { RowDataPacket } from 'mysql2/promise';
import pool from '../config/db';
import { Receipt } from '../types';

interface ReceiptRow extends RowDataPacket, Receipt {}

export const receiptModel = {
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
