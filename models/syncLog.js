import { query } from '../config/db.js';

export async function add(entry) {
  await query(
    `INSERT INTO sync_logs (anonymous_session_id, scan_id, client_scan_id, action, status, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.sessionId,
      entry.scanId || null,
      entry.clientScanId,
      entry.action,
      entry.status,
      entry.detail?.slice(0, 255) || null,
    ],
  );
}
