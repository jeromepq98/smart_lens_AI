import { Router } from 'express';
import { anonymousSession } from '../middleware/anonymousSession.js';
import { maintenanceMode } from '../middleware/maintenance.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { uploadImage } from '../middleware/upload.js';
import {
  chatLimiter,
  globalApiLimiter,
  reanalyzeLimiter,
  scanLimiter,
} from '../middleware/rateLimit.js';
import { getConfig } from '../controllers/configController.js';
import { listCategories } from '../controllers/categoryController.js';
import {
  createScan,
  deleteScan,
  getScan,
  getScanImage,
  listScans,
  reanalyzeScan,
} from '../controllers/scanController.js';
import {
  clearChat,
  getChat,
  regenerateAnswer,
  sendMessage,
} from '../controllers/chatController.js';
import { generateLearning } from '../controllers/learningController.js';
import {
  createScanSchema,
  learningSchema,
  listScansQuerySchema,
  reanalyzeSchema,
  scanIdAliasParamsSchema,
  scanIdParamsSchema,
} from '../validators/scan.js';
import { chatMessageSchema, regenerateSchema } from '../validators/chat.js';

const router = Router();

router.use(anonymousSession);
router.use(globalApiLimiter);

router.get('/config', getConfig);
router.get('/categories', listCategories);

router.use(maintenanceMode);

router.get('/scans', validateQuery(listScansQuerySchema), listScans);
router.post('/scans', scanLimiter, uploadImage, validateBody(createScanSchema), createScan);
router.get('/scans/:id', validateParams(scanIdParamsSchema), getScan);
router.get('/scans/:id/image', validateParams(scanIdParamsSchema), getScanImage);
router.delete('/scans/:id', validateParams(scanIdParamsSchema), deleteScan);
router.post(
  '/scans/:id/reanalyze',
  reanalyzeLimiter,
  validateParams(scanIdParamsSchema),
  validateBody(reanalyzeSchema),
  reanalyzeScan,
);
router.post(
  '/scans/:id/learning',
  chatLimiter,
  validateParams(scanIdParamsSchema),
  validateBody(learningSchema),
  generateLearning,
);

router.get('/chat/:scanId', validateParams(scanIdAliasParamsSchema), getChat);
router.post(
  '/chat/:scanId/messages',
  chatLimiter,
  validateParams(scanIdAliasParamsSchema),
  validateBody(chatMessageSchema),
  sendMessage,
);
router.post(
  '/chat/:scanId/regenerate',
  chatLimiter,
  validateParams(scanIdAliasParamsSchema),
  validateBody(regenerateSchema),
  regenerateAnswer,
);
router.delete('/chat/:scanId', validateParams(scanIdAliasParamsSchema), clearChat);

export default router;
