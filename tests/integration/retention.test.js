import { afterAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../../config/env.js';
import { closePool, query } from '../../config/db.js';
import { runRetention } from '../../services/retentionService.js';

const storageKey = `scans/retention-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
const diskPath = path.resolve(config.upload.dir, storageKey);
const scanId = crypto.randomUUID();

afterAll(async () => {
  await query('DELETE FROM scans WHERE id = ?', [scanId]).catch(() => {});
  await fs.unlink(diskPath).catch(() => {});
  await closePool();
});

describe('data retention', () => {
  it('deletes expired scans, their image rows and stored files', async () => {
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, 'retention fixture');

    await query(
      `INSERT INTO scans (id, anonymous_session_id, idempotency_key, source, language, status, expires_at)
       VALUES (?, ?, ?, 'upload', 'en', 'failed', DATE_SUB(NOW(3), INTERVAL 1 DAY))`,
      [scanId, 'retention-test-session', crypto.randomUUID()],
    );
    await query(
      `INSERT INTO scan_images
         (scan_id, storage_provider, storage_key, mime_type, width, height, byte_size, sha256)
       VALUES (?, 'local', ?, 'image/jpeg', 10, 10, 4, ?)`,
      [scanId, storageKey, '0'.repeat(64)],
    );

    const summary = await runRetention();
    expect(summary.dryRun).toBe(false);
    expect(summary.removed).toBeGreaterThanOrEqual(1);

    const scans = await query('SELECT id FROM scans WHERE id = ?', [scanId]);
    expect(scans).toHaveLength(0);

    const images = await query('SELECT id FROM scan_images WHERE scan_id = ?', [scanId]);
    expect(images).toHaveLength(0);

    await expect(fs.access(diskPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports counts without deleting in dry-run mode', async () => {
    const summary = await runRetention({ dryRun: true });
    expect(summary).toMatchObject({ dryRun: true });
    expect(summary.scans).toBeTypeOf('number');
  });
});
