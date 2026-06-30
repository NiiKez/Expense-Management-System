import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { getMe, getMyDirectory, updateMyPreferences } from '../controllers/meController';
import { getMyStats } from '../controllers/statsController';
import { updatePreferencesSchema } from '../validations/userSchema';

const router = Router();

// All /me routes act on the authenticated caller only.
router.use(authenticate);

// GET /api/v1/me — current user's profile, manager name, and preferences
router.get('/', getMe);

// PATCH /api/v1/me/preferences — update the caller's own settings
router.patch('/preferences', validate(updatePreferencesSchema), updateMyPreferences);

// GET /api/v1/me/directory — live Graph reporting line, groups, and org attrs
router.get('/directory', getMyDirectory);

// GET /api/v1/me/stats — aggregated stats for the current user
router.get('/stats', getMyStats);

export default router;
