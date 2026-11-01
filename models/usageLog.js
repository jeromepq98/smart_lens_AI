import { query } from '../config/db.js';

export async function add(entry) {
  await query(
    `INSERT INTO usage_logs
       (anonymous_session_id, scan_id, kind, endpoint, model, tokens_in, tokens_out,
        estimated_cost_usd, status, error_code, latency_ms, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.sessionId || null,
      entry.scanId || null,
      entry.kind,
      entry.endpoint || null,
      entry.model || null,
      entry.tokensIn || 0,
      entry.tokensOut || 0,
      entry.estimatedCostUsd || 0,
      entry.status,
      entry.errorCode || null,
      entry.latencyMs || null,
      entry.ipHash || null,
    ],
  );
}

export async function recentErrors(limit = 20) {
  return query(
    `SELECT id, kind, endpoint, model, error_code, status, created_at
     FROM usage_logs
     WHERE status = 'error'
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit],
  );
}
