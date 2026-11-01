import { query } from '../config/db.js';

export async function create({ id, sessionId, idempotencyKey, source, language, expiresAt }) {
  await query(
    `INSERT INTO scans (id, anonymous_session_id, idempotency_key, source, language, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, sessionId, idempotencyKey, source, language, expiresAt],
  );
}

export async function findById(id) {
  const rows = await query('SELECT * FROM scans WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
  return rows[0] || null;
}

export async function findByIdForSession(id, sessionId) {
  const rows = await query(
    'SELECT * FROM scans WHERE id = ? AND anonymous_session_id = ? AND deleted_at IS NULL LIMIT 1',
    [id, sessionId],
  );
  return rows[0] || null;
}

export async function findByIdempotency(sessionId, idempotencyKey) {
  const rows = await query(
    `SELECT * FROM scans
     WHERE anonymous_session_id = ? AND idempotency_key = ? AND deleted_at IS NULL
     LIMIT 1`,
    [sessionId, idempotencyKey],
  );
  return rows[0] || null;
}

export async function listForSession(sessionId, { limit = 20, before, category, q, from, to } = {}) {
  const where = ['s.anonymous_session_id = ?', 's.deleted_at IS NULL'];
  const params = [sessionId];

  if (before) {
    where.push('s.created_at < ?');
    params.push(before);
  }
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (q) {
    where.push('(ar.main_identification LIKE ? OR ar.description LIKE ?)');
    const pattern = `%${q}%`;
    params.push(pattern, pattern);
  }
  if (from) {
    where.push('s.created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('s.created_at <= ?');
    params.push(to);
  }

  params.push(limit);

  return query(
    `SELECT s.id, s.created_at, s.source, s.language, s.status, s.has_image, s.category_id,
            c.slug AS category_slug, c.name_en, c.name_fil, c.name_ceb, c.icon,
            ar.id AS ai_result_id, ar.main_identification, ar.scientific_name, ar.confidence,
            ar.description, ar.version AS result_version
     FROM scans s
     LEFT JOIN categories c ON c.id = s.category_id
     LEFT JOIN ai_results ar ON ar.scan_id = s.id AND ar.is_current = 1
     WHERE ${where.join(' AND ')}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT ?`,
    params,
  );
}

export async function countTodayForSession(sessionId) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM scans
     WHERE anonymous_session_id = ? AND created_at >= CURDATE()`,
    [sessionId],
  );
  return Number(rows[0]?.count || 0);
}

export async function markProcessing(id) {
  await query(`UPDATE scans SET status = 'processing', error_code = NULL WHERE id = ?`, [id]);
}

export async function markCompleted(connection, id, categoryId) {
  await connection.query(
    `UPDATE scans
     SET status = 'completed', category_id = ?, error_code = NULL, has_image = 1
     WHERE id = ?`,
    [categoryId, id],
  );
}

export async function markFailed(id, errorCode) {
  await query(`UPDATE scans SET status = 'failed', error_code = ? WHERE id = ?`, [
    errorCode?.slice(0, 60) || 'AI_ERROR',
    id,
  ]);
}

export async function markImageStored(id) {
  await query('UPDATE scans SET has_image = 1 WHERE id = ?', [id]);
}

export async function removeById(id) {
  await query('DELETE FROM scans WHERE id = ?', [id]);
}

export async function countAll() {
  const rows = await query('SELECT COUNT(*) AS count FROM scans WHERE deleted_at IS NULL');
  return Number(rows[0]?.count || 0);
}
