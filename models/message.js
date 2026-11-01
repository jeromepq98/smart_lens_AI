import { query } from '../config/db.js';

export function mapMessage(row) {
  return {
    id: Number(row.id),
    role: row.role,
    content: row.content,
    locale: row.locale,
    model: row.model,
    createdAt: row.created_at,
  };
}

export async function add(data) {
  const rows = await query(
    `INSERT INTO messages (conversation_id, role, content, locale, model, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.conversationId,
      data.role,
      data.content,
      data.locale || null,
      data.model || null,
      data.tokensIn || 0,
      data.tokensOut || 0,
    ],
  );
  const inserted = await query('SELECT * FROM messages WHERE id = ?', [rows.insertId]);
  return inserted[0];
}

export async function listByConversation(conversationId, limit = 100) {
  return query(
    `SELECT * FROM (
       SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY id DESC
       LIMIT ?
     ) recent
     ORDER BY id ASC`,
    [conversationId, limit],
  );
}

export async function listRecent(conversationId, limit = 20) {
  const rows = await query(
    `SELECT * FROM messages
     WHERE conversation_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [conversationId, limit],
  );
  return rows.reverse();
}

export async function findLastAssistant(conversationId) {
  const rows = await query(
    `SELECT * FROM messages
     WHERE conversation_id = ? AND role = 'assistant'
     ORDER BY id DESC
     LIMIT 1`,
    [conversationId],
  );
  return rows[0] || null;
}

export async function findLastUser(conversationId) {
  const rows = await query(
    `SELECT * FROM messages
     WHERE conversation_id = ? AND role = 'user'
     ORDER BY id DESC
     LIMIT 1`,
    [conversationId],
  );
  return rows[0] || null;
}

export async function removeLastAssistant(conversationId) {
  const last = await findLastAssistant(conversationId);
  if (!last) return null;
  await query('DELETE FROM messages WHERE id = ?', [last.id]);
  return last;
}

export async function countByConversation(conversationId) {
  const rows = await query('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?', [
    conversationId,
  ]);
  return Number(rows[0]?.count || 0);
}

export async function removeById(id) {
  await query('DELETE FROM messages WHERE id = ?', [id]);
}

export async function removeByConversation(conversationId) {
  await query('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
}
