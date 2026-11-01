import { query } from '../config/db.js';

export async function findByUsername(username) {
  const rows = await query('SELECT * FROM admin_users WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

export async function findById(id) {
  const rows = await query('SELECT * FROM admin_users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

export async function recordFailedLogin(id, { maxAttempts = 5, lockMinutes = 15 } = {}) {
  await query(
    `UPDATE admin_users
     SET failed_attempts = failed_attempts + 1,
         locked_until = IF(failed_attempts + 1 >= ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE), locked_until)
     WHERE id = ?`,
    [maxAttempts, lockMinutes, id],
  );
  const rows = await query('SELECT failed_attempts, locked_until FROM admin_users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

export async function recordSuccessfulLogin(id) {
  await query(
    `UPDATE admin_users
     SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [id],
  );
}

export async function updatePassword(id, passwordHash) {
  await query(
    `UPDATE admin_users
     SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL
     WHERE id = ?`,
    [passwordHash, id],
  );
}
