import { query } from '../config/db.js';
import { getEffectiveSettings } from './settingsService.js';
import * as storage from './storage.js';
import logger from '../utils/logger.js';

const BATCH_SIZE = 200;

function daysAgo(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function purgeExpiredScans(now) {
  let removed = 0;
  let imagesRemoved = 0;

  for (;;) {
    const rows = await query(
      `SELECT s.id, i.storage_provider, i.storage_key
       FROM scans s
       LEFT JOIN scan_images i ON i.scan_id = s.id
       WHERE s.expires_at IS NOT NULL AND s.expires_at <= ?
       ORDER BY s.expires_at
       LIMIT ${BATCH_SIZE}`,
      [now],
    );
    if (!rows.length) break;

    const scanIds = [...new Set(rows.map((row) => row.id))];
    await query(`DELETE FROM scans WHERE id IN (${scanIds.map(() => '?').join(',')})`, scanIds);

    for (const row of rows) {
      if (!row.storage_key) continue;
      await storage.deleteImage({ provider: row.storage_provider, key: row.storage_key });
      imagesRemoved += 1;
    }

    removed += scanIds.length;
    if (rows.length < BATCH_SIZE) break;
  }

  return { removed, imagesRemoved };
}

async function purgeOldLogs(now, settings) {
  const usageCutoff = daysAgo(settings.retention.usageLogDays, now);
  const errorCutoff = daysAgo(settings.retention.errorLogDays, now);

  let usageRemoved = 0;
  let errorRemoved = 0;
  let sessionsRemoved = 0;

  for (;;) {
    const result = await query('DELETE FROM usage_logs WHERE created_at < ? LIMIT ?', [usageCutoff, BATCH_SIZE]);
    usageRemoved += result.affectedRows;
    if (result.affectedRows < BATCH_SIZE) break;
  }

  for (;;) {
    const result = await query('DELETE FROM error_logs WHERE created_at < ? LIMIT ?', [errorCutoff, BATCH_SIZE]);
    errorRemoved += result.affectedRows;
    if (result.affectedRows < BATCH_SIZE) break;
  }

  const sessions = await query('DELETE FROM admin_sessions WHERE expires_at <= ?', [now]);
  sessionsRemoved = sessions.affectedRows;

  return { usageRemoved, errorRemoved, sessionsRemoved };
}

export async function runRetention({ now = new Date(), dryRun = false } = {}) {
  const settings = await getEffectiveSettings({ force: true });

  if (dryRun) {
    const [scans] = await query(
      'SELECT COUNT(*) AS count FROM scans WHERE expires_at IS NOT NULL AND expires_at <= ?',
      [now],
    );
    const [usage] = await query('SELECT COUNT(*) AS count FROM usage_logs WHERE created_at < ?', [
      daysAgo(settings.retention.usageLogDays, now),
    ]);
    const [errors] = await query('SELECT COUNT(*) AS count FROM error_logs WHERE created_at < ?', [
      daysAgo(settings.retention.errorLogDays, now),
    ]);
    return {
      dryRun: true,
      scans: Number(scans.count),
      usageLogs: Number(usage.count),
      errorLogs: Number(errors.count),
    };
  }

  const scans = await purgeExpiredScans(now);
  const logs = await purgeOldLogs(now, settings);
  const summary = { dryRun: false, ...scans, ...logs };

  logger.info(summary, 'Retention cleanup finished');
  return summary;
}

export async function startRetentionScheduler({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  const run = () =>
    runRetention().catch((error) => logger.error({ err: error.message }, 'Retention cleanup failed'));

  const timer = setInterval(run, intervalMs);
  timer.unref();
  setTimeout(run, 30 * 1000).unref();

  return () => clearInterval(timer);
}
