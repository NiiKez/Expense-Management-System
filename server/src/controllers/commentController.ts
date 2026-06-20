import { Request, Response, NextFunction } from 'express';
import { expenseModel } from '../models/expense';
import { commentModel } from '../models/comment';
import { notFound } from '../utils/errors';
import { parsePositiveId } from '../utils/requestParsing';
import { ensureCanAccessExpense } from '../services/managerAuthorization';
import { notificationService } from '../services/notificationService';
import { Comment } from '../types';

function serializeComment(c: Comment) {
  return {
    id: c.id,
    expense_id: c.expense_id,
    author_id: c.author_id,
    author_name: c.author_name,
    author_role: c.author_role,
    body: c.body,
    created_at: c.created_at,
  };
}

export const getComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    await ensureCanAccessExpense(req, expense.submitted_by);

    const comments = await commentModel.findByExpenseId(expenseId);
    res.json({ success: true, data: comments.map(serializeComment) });
  } catch (err) {
    next(err);
  }
};

export const addComment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expenseId = parsePositiveId(req.params.id, 'expense ID');

    const expense = await expenseModel.findById(expenseId);
    if (!expense) {
      next(notFound('Expense'));
      return;
    }

    await ensureCanAccessExpense(req, expense.submitted_by);

    // Body shape enforced by createCommentSchema via validate() middleware.
    const body: string = req.body.body.trim();
    const comment = await commentModel.create({
      expense_id: expenseId,
      author_id: req.user!.id,
      body,
    });

    await notificationService.expenseComment({ expense, actor: req.user! });

    res.status(201).json({ success: true, data: serializeComment(comment) });
  } catch (err) {
    next(err);
  }
};
