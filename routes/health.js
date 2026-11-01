import { Router } from 'express';
import config from '../config/env.js';
import { ping } from '../config/db.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    version: config.version,
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (req, res) => {
  try {
    await ping();
    res.json({ status: 'ready', database: 'up', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'not_ready', database: 'down', timestamp: new Date().toISOString() });
  }
});

export default router;
