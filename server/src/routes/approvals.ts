import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { Role } from '../types';
import {
  getPendingApprovals,
  approveExpense,
  rejectExpense,
} from '../controllers/approvalController';
import { rejectExpenseSchema } from '../validations/expenseSchema';

const router = Router();

// All approval routes require authentication
router.use(authenticate);

// GET /api/v1/approvals/pending — Pending expenses for direct reports (MANAGER, ADMIN)
router.get(
  '/pending',
  authorize([Role.MANAGER, Role.ADMIN]),
  getPendingApprovals,
);

// PATCH /api/v1/approvals/:id/approve — Approve an expense (MANAGER, ADMIN)
router.patch(
  '/:id/approve',
  authorize([Role.MANAGER, Role.ADMIN]),
  approveExpense,
);

// PATCH /api/v1/approvals/:id/reject — Reject an expense (MANAGER, ADMIN)
router.patch(
  '/:id/reject',
  authorize([Role.MANAGER, Role.ADMIN]),
  validate(rejectExpenseSchema),
  rejectExpense,
);

export default router;
