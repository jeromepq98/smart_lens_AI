import { query } from '../config/db.js';

export async function create({ id, tokenHash, adminId, csrfSecret, ipHash, userAgent, expiresAt }) {
  await query(
    `INSERT INTO admin_sessions (id, token_hash, admin_id, csrf_secret, ip_hash, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, tokenHash, adminId, csrfSecret, ipHash || null, userAgent?.slice(0, 255) || null, expiresAt],
  );
}

export async function findValidByTokenHash(tokenHash) {
  const rows = await query(
    `SELECT s.id, s.admin_id, s.csrf_secret, s.expires_at, s.last_seen_at,
            u.username, u.display_name, u.is_active, u.must_change_password
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(3)
     LIMIT 1`,
    [tokenHash],
  );
  return rows[0] || null;
}

export async function touch(id) {
  await query(
    `UPDATE admin_sessions
     SET last_seen_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))`,
    [id],
  );
}

export async function removeById(id) {
  await query('DELETE FROM admin_sessions WHERE id = ?', [id]);
}

export async function removeForAdmin(adminId, exceptId = null) {
  if (exceptId) {
    await query('DELETE FROM admin_sessions WHERE admin_id = ? AND id <> ?', [adminId, exceptId]);
    return;
  }
  await query('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId]);
}

export async function removeExpired() {
  await query('DELETE FROM admin_sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)');
}

export async function countActive() {
  const rows = await query(
    'SELECT COUNT(*) AS count FROM admin_sessions WHERE expires_at > CURRENT_TIMESTAMP(3)',
  );
  return Number(rows[0]?.count || 0);
}
