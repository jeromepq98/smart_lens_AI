import { parseJsonColumn, query } from '../config/db.js';

const JSON_FIELDS = [
  'characteristics',
  'common_uses',
  'interesting_facts',
  'safety',
  'alternatives',
  'observations',
  'assumptions',
  'follow_up_questions',
];

export function mapAiResult(row) {
  if (!row) return null;
  const mapped = {
    id: Number(row.id),
    scanId: row.scan_id,
    version: Number(row.version),
    model: row.model,
    promptVersion: row.prompt_version,
    locale: row.locale,
    mainIdentification: row.main_identification,
    categorySlug: row.category_slug,
    scientificName: row.scientific_name || '',
    confidence: row.confidence,
    description: row.description,
    uncertaintyNotes: row.uncertainty_notes || '',
    tokensIn: Number(row.tokens_in || 0),
    tokensOut: Number(row.tokens_out || 0),
    latencyMs: Number(row.latency_ms || 0),
    createdAt: row.created_at,
  };
  for (const field of JSON_FIELDS) mapped[field] = parseJsonColumn(row[field], []);
  return mapped;
}

export async function insertVersion(connection, data) {
  const [versionRows] = await connection.query(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM ai_results WHERE scan_id = ?',
    [data.scanId],
  );
  const version = Number(versionRows[0]?.next_version || 1);

  await connection.query('UPDATE ai_results SET is_current = 0 WHERE scan_id = ?', [data.scanId]);

  const [result] = await connection.query(
    `INSERT INTO ai_results
       (scan_id, version, is_current, model, prompt_version, locale, main_identification,
        category_slug, scientific_name, confidence, description, characteristics, common_uses,
        interesting_facts, safety, alternatives, observations, assumptions, follow_up_questions,
        uncertainty_notes, tokens_in, tokens_out, latency_ms)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.scanId,
      version,
      data.model,
      data.promptVersion,
      data.locale,
      data.mainIdentification,
      data.categorySlug,
      data.scientificName || null,
      data.confidence,
      data.description,
      JSON.stringify(data.characteristics || []),
      JSON.stringify(data.commonUses || []),
      JSON.stringify(data.interestingFacts || []),
      JSON.stringify(data.safety || []),
      JSON.stringify(data.alternatives || []),
      JSON.stringify(data.observations || []),
      JSON.stringify(data.assumptions || []),
      JSON.stringify(data.followUpQuestions || []),
      data.uncertaintyNotes || null,
      data.tokensIn || 0,
      data.tokensOut || 0,
      data.latencyMs || 0,
    ],
  );

  const [rows] = await connection.query('SELECT * FROM ai_results WHERE id = ?', [result.insertId]);
  return rows[0];
}

export async function findCurrentByScanId(scanId) {
  const rows = await query(
    'SELECT * FROM ai_results WHERE scan_id = ? AND is_current = 1 ORDER BY version DESC LIMIT 1',
    [scanId],
  );
  return rows[0] || null;
}

export async function findById(id) {
  const rows = await query('SELECT * FROM ai_results WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}
