import { query } from '../config/db.js';

export async function listActive() {
  return query(
    `SELECT id, slug, name_en, name_fil, name_ceb, icon, sort_order
     FROM categories
     WHERE is_active = 1
     ORDER BY sort_order ASC, id ASC`,
  );
}

export async function findBySlug(slug) {
  const rows = await query(
    `SELECT id, slug, name_en, name_fil, name_ceb, icon
     FROM categories
     WHERE slug = ? AND is_active = 1
     LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

export async function findById(id) {
  const rows = await query(
    `SELECT id, slug, name_en, name_fil, name_ceb, icon
     FROM categories
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}
