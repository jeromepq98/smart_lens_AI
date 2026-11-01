import { query } from '../config/db.js';

export async function add({ adminId = null, action, entity = null, entityId = null, metadata = null, ipHash = null }) {
  await query(
    `INSERT INTO audit_logs (admin_id, action, entity, entity_id, metadata, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      adminId,
      action.slice(0, 60),
      entity?.slice(0, 40) || null,
      entityId ? String(entityId).slice(0, 64) : null,
      metadata ? JSON.stringify(metadata) : null,
      ipHash,
    ],
  );
}

export async function list({ limit = 50, before = null, action = null } = {}) {
  const where = [];
  const params = [];
  if (before) {
    where.push('a.created_at < ?');
    params.push(before);
  }
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  params.push(limit);

  return query(
    `SELECT a.id, a.admin_id, a.action, a.entity, a.entity_id, a.metadata, a.created_at,
            u.username
     FROM audit_logs a
     LEFT JOIN admin_users u ON u.id = a.admin_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ?`,
    params,
  );
}

export async function listActions() {
  const rows = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  return rows.map((row) => row.action);
}
