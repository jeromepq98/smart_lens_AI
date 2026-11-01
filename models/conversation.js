import { query } from '../config/db.js';
import { newId } from '../utils/uuid.js';

export async function ensure(connection, scanId, sessionId) {
  const [existing] = await connection.query(
    'SELECT * FROM conversations WHERE scan_id = ? LIMIT 1',
    [scanId],
  );
  if (existing.length > 0) return existing[0];

  const id = newId();
  await connection.query(
    'INSERT INTO conversations (id, scan_id, anonymous_session_id) VALUES (?, ?, ?)',
    [id, scanId, sessionId],
  );
  return { id, scan_id: scanId, anonymous_session_id: sessionId };
}

export async function findByScanId(scanId) {
  const rows = await query('SELECT * FROM conversations WHERE scan_id = ? LIMIT 1', [scanId]);
  return rows[0] || null;
}

export async function findByIdForSession(id, sessionId) {
  const rows = await query(
    'SELECT * FROM conversations WHERE id = ? AND anonymous_session_id = ? LIMIT 1',
    [id, sessionId],
  );
  return rows[0] || null;
}

export async function touch(connection, id) {
  const executor = connection || { query };
  await executor.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
}

export async function removeByScanId(scanId) {
  await query('DELETE FROM conversations WHERE scan_id = ?', [scanId]);
}
