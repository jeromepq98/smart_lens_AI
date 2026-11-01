import { Router } from 'express';
import { adminLoginLimiter } from '../middleware/rateLimit.js';
import { requireAdmin, requirePasswordChanged } from '../middleware/adminAuth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  changePassword,
  login,
  logout,
  me,
} from '../controllers/adminAuthController.js';
import {
  auditLogs,
  dashboard,
  getSettings,
  systemHealth,
  updateSettings,
  usage,
} from '../controllers/adminController.js';
import {
  adminLoginSchema,
  adminSettingsSchema,
  auditQuerySchema,
  changePasswordSchema,
  usageQuerySchema,
} from '../validators/admin.js';

const router = Router();

router.post('/login', adminLoginLimiter, validateBody(adminLoginSchema), login);

router.use(requireAdmin);
router.get('/me', me);
router.post('/logout', logout);
router.post('/password', validateBody(changePasswordSchema), changePassword);

router.use(requirePasswordChanged);
router.get('/dashboard', dashboard);
router.get('/settings', getSettings);
router.put('/settings', validateBody(adminSettingsSchema), updateSettings);
router.get('/usage', validateQuery(usageQuerySchema), usage);
router.get('/system-health', systemHealth);
router.get('/audit-logs', validateQuery(auditQuerySchema), auditLogs);

export default router;
