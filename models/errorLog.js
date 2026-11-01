import { query } from '../config/db.js';
import logger from '../utils/logger.js';

export async function add({ requestId, level = 'error', code, message, path, metadata }) {
  try {
    await query(
      `INSERT INTO error_logs (request_id, level, code, message, path, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        requestId || null,
        level,
        code?.slice(0, 60) || null,
        String(message || '').slice(0, 1000),
        path?.slice(0, 255) || null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
  } catch (error) {
    logger.warn({ err: error.message }, 'failed to persist error log');
  }
}

export async function recent(limit = 20) {
  return query(
    `SELECT id, request_id, level, code, message, path, created_at
     FROM error_logs
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [limit],
  );
}

export async function countSince(hours = 24) {
  const rows = await query(
    'SELECT COUNT(*) AS count FROM error_logs WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)',
    [hours],
  );
  return Number(rows[0]?.count || 0);
}
