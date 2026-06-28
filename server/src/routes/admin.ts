import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, denyDemo } from '../middleware/rbac';
import { Role } from '../types';
import {
  getAuditLogs,
  getAllExpenses,
  getAllUsers,
  exportAllExpenses,
  exportAuditLogs,
} from '../controllers/adminController';
import { getAdminStats } from '../controllers/statsController';

const router = Router();

// All admin routes require authentication + ADMIN role, never a demo session.
router.use(authenticate);
router.use(authorize([Role.ADMIN]));
router.use(denyDemo);

// GET /api/v1/admin/expenses — All expenses with filters and pagination
router.get('/expenses', getAllExpenses);

// GET /api/v1/admin/expenses/export — CSV of the filtered org ledger
router.get('/expenses/export', exportAllExpenses);

// GET /api/v1/admin/users — List all users (roles are managed in Entra ID App Roles)
router.get('/users', getAllUsers);

// GET /api/v1/admin/audit-logs — Query audit logs with filters
router.get('/audit-logs', getAuditLogs);

// GET /api/v1/admin/audit-logs/export — CSV of the filtered audit trail
router.get('/audit-logs/export', exportAuditLogs);

// GET /api/v1/admin/stats — Org-wide aggregate stats
router.get('/stats', getAdminStats);

export default router;
