import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { Role } from '../types';
import { getOrgTree, getOrgUser } from '../controllers/orgController';

const router = Router();

router.use(authenticate);

// GET /api/v1/org/tree — org reporting hierarchy as a flat node list.
// ADMIN: the whole org graph. MANAGER: their own subtree. EMPLOYEE: 403.
router.get('/tree', authorize([Role.MANAGER, Role.ADMIN]), getOrgTree);

// GET /api/v1/org/users/:id — detail behind a single node (Graph-enriched for
// real sessions, DB-only for demo). Same roles; per-node visibility is
// re-checked inside the controller (a MANAGER only sees their own subtree).
router.get('/users/:id', authorize([Role.MANAGER, Role.ADMIN]), getOrgUser);

export default router;
