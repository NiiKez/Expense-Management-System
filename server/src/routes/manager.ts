import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { Role } from '../types';
import { getManagerEmployees } from '../controllers/managerController';
import { getManagerStats } from '../controllers/statsController';

const router = Router();

router.use(authenticate);

// GET /api/v1/manager/employees - Manager-only employee directory sourced from Graph API
router.get('/employees', authorize([Role.MANAGER]), getManagerEmployees);

// GET /api/v1/manager/stats — Manager-only team rollup aggregates
router.get('/stats', authorize([Role.MANAGER]), getManagerStats);


export default router;
