import { query } from '../config/db.js';

export async function create(connection, data) {
  const sql = `INSERT INTO scan_images
       (scan_id, storage_provider, storage_key, mime_type, original_filename, width, height, byte_size, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    data.scanId,
    data.storageProvider,
    data.storageKey,
    data.mimeType,
    data.originalFilename || null,
    data.width,
    data.height,
    data.byteSize,
    data.sha256,
  ];

  if (connection) {
    const [result] = await connection.query(sql, params);
    return result.insertId;
  }
  const result = await query(sql, params);
  return result.insertId;
}

export async function findByScanId(scanId) {
  const rows = await query('SELECT * FROM scan_images WHERE scan_id = ? LIMIT 1', [scanId]);
  return rows[0] || null;
}
