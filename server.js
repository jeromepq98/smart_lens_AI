import { createApp } from './app.js';
import config from './config/env.js';
import { closePool, ping } from './config/db.js';
import { startRetentionScheduler } from './services/retentionService.js';
import logger from './utils/logger.js';

const app = createApp();

const server = app.listen(config.port, async () => {
  logger.info({ port: config.port, env: config.nodeEnv }, `SmartLens AI running at ${config.appUrl}`);
  try {
    await ping();
    logger.info('Database connection OK');
  } catch (error) {
    logger.warn({ err: error.message }, 'Database is not reachable. Run "npm run db:setup" first.');
  }
  startRetentionScheduler();
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const forceTimer = setTimeout(() => {
    logger.fatal('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  server.close(async () => {
    try {
      await closePool();
    } catch (error) {
      logger.error({ err: error.message }, 'Failed to close database pool');
    }
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException');
});

export { app, server };
