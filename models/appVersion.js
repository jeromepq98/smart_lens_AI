import { query } from '../config/db.js';

export async function current() {
  const rows = await query(
    'SELECT version, released_at, notes FROM app_versions WHERE is_current = 1 ORDER BY released_at DESC LIMIT 1',
  );
  return rows[0] || null;
}

export async function list(limit = 20) {
  return query(
    'SELECT version, released_at, notes, is_current FROM app_versions ORDER BY released_at DESC LIMIT ?',
    [limit],
  );
}
