import { query } from '../config/db.js';

export async function insertMany(connection, { scanId, aiResultId, locale, items }) {
  let priority = 0;
  for (const item of items) {
    await connection.query(
      `INSERT INTO recommendations (scan_id, ai_result_id, kind, title, body, priority, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [scanId, aiResultId, item.kind, item.title, item.body, priority, locale],
    );
    priority += 1;
  }
}

export async function listByAiResultId(aiResultId) {
  return query(
    `SELECT id, kind, title, body, priority
     FROM recommendations
     WHERE ai_result_id = ?
     ORDER BY priority ASC, id ASC`,
    [aiResultId],
  );
}

export function mapRecommendation(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    priority: Number(row.priority || 0),
  };
}
