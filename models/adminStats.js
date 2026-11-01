import { query } from '../config/db.js';

function num(value) {
  return Number(value || 0);
}

export async function scanSummary() {
  const rows = await query(
    `SELECT COUNT(*) AS total,
            SUM(created_at >= CURDATE()) AS today,
            SUM(status = 'completed') AS completed,
            SUM(status = 'failed') AS failed,
            SUM(status IN ('pending', 'processing')) AS active
     FROM scans
     WHERE deleted_at IS NULL`,
  );
  const row = rows[0] || {};
  return {
    total: num(row.total),
    today: num(row.today),
    completed: num(row.completed),
    failed: num(row.failed),
    active: num(row.active),
  };
}

export async function scansPerDay(days = 14) {
  return query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count
     FROM scans
     WHERE deleted_at IS NULL AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY day`,
    [days - 1],
  ).then((rows) => rows.map((row) => ({ day: row.day, count: num(row.count) })));
}

export async function topCategories(limit = 6) {
  const rows = await query(
    `SELECT c.slug, c.name_en, c.icon, COUNT(*) AS count
     FROM scans s
     JOIN categories c ON c.id = s.category_id
     WHERE s.deleted_at IS NULL AND s.category_id IS NOT NULL
     GROUP BY c.id, c.slug, c.name_en, c.icon
     ORDER BY count DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({ ...row, count: num(row.count) }));
}

export async function usageSummary({ days = 1, sinceToday = false } = {}) {
  const where = sinceToday ? 'created_at >= CURDATE()' : 'created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)';
  const params = sinceToday ? [] : [days - 1];
  const rows = await query(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(tokens_in), 0) AS tokens_in,
            COALESCE(SUM(tokens_out), 0) AS tokens_out,
            COALESCE(SUM(estimated_cost_usd), 0) AS cost,
            COALESCE(SUM(status = 'error'), 0) AS errors
     FROM usage_logs
     WHERE ${where}`,
    params,
  );
  const row = rows[0] || {};
  return {
    requests: num(row.requests),
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
    cost: num(row.cost),
    errors: num(row.errors),
  };
}

export async function usagePerDay(days = 7) {
  const rows = await query(
    `SELECT DATE(created_at) AS day,
            COUNT(*) AS requests,
            COALESCE(SUM(estimated_cost_usd), 0) AS cost
     FROM usage_logs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY day`,
    [days - 1],
  );
  return rows.map((row) => ({ day: row.day, requests: num(row.requests), cost: num(row.cost) }));
}

export async function usageByKind(days = 30) {
  const rows = await query(
    `SELECT kind,
            COUNT(*) AS requests,
            COALESCE(SUM(tokens_in), 0) AS tokens_in,
            COALESCE(SUM(tokens_out), 0) AS tokens_out,
            COALESCE(SUM(estimated_cost_usd), 0) AS cost,
            COALESCE(SUM(status = 'error'), 0) AS errors
     FROM usage_logs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY kind
     ORDER BY requests DESC`,
    [days - 1],
  );
  return rows.map((row) => ({
    kind: row.kind,
    requests: num(row.requests),
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
    cost: num(row.cost),
    errors: num(row.errors),
  }));
}

export async function usageByModel(days = 30) {
  const rows = await query(
    `SELECT COALESCE(model, 'unknown') AS model,
            COUNT(*) AS requests,
            COALESCE(SUM(tokens_in), 0) AS tokens_in,
            COALESCE(SUM(tokens_out), 0) AS tokens_out,
            COALESCE(SUM(estimated_cost_usd), 0) AS cost
     FROM usage_logs
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY model
     ORDER BY requests DESC`,
    [days - 1],
  );
  return rows.map((row) => ({
    model: row.model,
    requests: num(row.requests),
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
    cost: num(row.cost),
  }));
}

export async function usageErrors(limit = 10) {
  return query(
    `SELECT id, kind, endpoint, model, error_code, status, latency_ms, created_at
     FROM usage_logs
     WHERE status = 'error'
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [limit],
  );
}

export async function storageSummary() {
  const rows = await query(
    `SELECT COUNT(*) AS images,
            COALESCE(SUM(byte_size), 0) AS bytes
     FROM scan_images`,
  );
  const row = rows[0] || {};
  return { images: num(row.images), bytes: num(row.bytes) };
}

export async function activeScansOlderThan(minutes = 10) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM scans
     WHERE deleted_at IS NULL AND status IN ('pending', 'processing')
       AND created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE)`,
    [minutes],
  );
  return num(rows[0]?.count);
}
