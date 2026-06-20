import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  createExpenseSchema,
  updateExpenseSchema,
  resubmitExpenseSchema,
  createCommentSchema,
} from '../validations/expenseSchema';
import { Role } from '../types';
import { upload, validateReceiptUpload } from '../middleware/upload';
import {
  createExpense,
  getExpenses,
  exportMyExpenses,
  getExpenseById,
  updateExpense,
  resubmitExpense,
  deleteExpense,
  downloadReceipt,
} from '../controllers/expenseController';
import { getComments, addComment } from '../controllers/commentController';

const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user!.id}`,
});

// All expense routes require authentication
router.use(authenticate);

// POST /api/v1/expenses — Create a new expense with optional receipt (EMPLOYEE+)
// Multer parses multipart/form-data; fields are available on req.body, file on req.file
router.post(
  '/',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  uploadLimiter,
  upload.single('receipt'),
  validateReceiptUpload,
  validate(createExpenseSchema),
  createExpense,
);

// GET /api/v1/expenses — List own expenses (EMPLOYEE+)
router.get(
  '/',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  getExpenses,
);

// GET /api/v1/expenses/export — CSV of own expenses (must precede /:id)
router.get(
  '/export',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  exportMyExpenses,
);

// GET /api/v1/expenses/:id — Get expense detail (EMPLOYEE+ own)
router.get(
  '/:id',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  getExpenseById,
);

// GET /api/v1/expenses/:id/receipts/:receiptId — Download receipt file
router.get(
  '/:id/receipts/:receiptId',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  downloadReceipt,
);

// PUT /api/v1/expenses/:id — Update own pending expense (EMPLOYEE only, own, PENDING)
router.put(
  '/:id',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  validate(updateExpenseSchema),
  updateExpense,
);

// POST /api/v1/expenses/:id/resubmit — Resubmit own REJECTED expense (back to PENDING)
router.post(
  '/:id/resubmit',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  validate(resubmitExpenseSchema),
  resubmitExpense,
);

// GET /api/v1/expenses/:id/comments — List comments (visible to anyone who can view the expense)
router.get(
  '/:id/comments',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  getComments,
);

// POST /api/v1/expenses/:id/comments — Add a comment
router.post(
  '/:id/comments',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  validate(createCommentSchema),
  addComment,
);

// DELETE /api/v1/expenses/:id — Delete own pending expense (EMPLOYEE only, own, PENDING)
router.delete(
  '/:id',
  authorize([Role.EMPLOYEE, Role.MANAGER, Role.ADMIN]),
  deleteExpense,
);

export default router;
