import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../app.js';
import { closePool, query } from '../../config/db.js';
import { invalidateSettingsCache } from '../../services/settingsService.js';
import * as storage from '../../services/storage.js';

const app = createApp();
const createdIds = new Set();
let originalLimits = null;

function sampleJpeg(width = 240, height = 240) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 15, g: 157, b: 118 } },
  })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  const rows = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'limits'");
  const current = rows[0] ? JSON.parse(rows[0].setting_value) : {};
  originalLimits = current;
  await query("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'limits'", [
    JSON.stringify({ ...current, scanPerMinute: 60, dailyScans: 200 }),
  ]);
  invalidateSettingsCache();
});

afterAll(async () => {
  if (originalLimits) {
    await query("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'limits'", [
      JSON.stringify(originalLimits),
    ]);
    invalidateSettingsCache();
  }
  for (const id of createdIds) {
    const images = await query('SELECT storage_provider, storage_key FROM scan_images WHERE scan_id = ?', [id]);
    for (const image of images) {
      await storage.deleteImage({ provider: image.storage_provider, key: image.storage_key });
    }
    await query('DELETE FROM scans WHERE id = ?', [id]).catch(() => {});
  }
  await closePool();
});

describe('scan upload API', () => {
  it('rejects a request without an image', async () => {
    const response = await request(app)
      .post('/api/scans')
      .field('language', 'en')
      .field('source', 'upload')
      .field('client_scan_id', 'f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('image file is required');
  });

  it('rejects a text file disguised as an image', async () => {
    const response = await request(app)
      .post('/api/scans')
      .field('language', 'en')
      .field('source', 'upload')
      .field('client_scan_id', 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
      .attach('image', Buffer.from('hello, not a jpeg'), {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('persists the scan and hides it from other anonymous sessions', async () => {
    const response = await request(app)
      .post('/api/scans')
      .field('language', 'en')
      .field('source', 'upload')
      .field('client_scan_id', '11111111-1111-4111-8111-111111111111')
      .attach('image', await sampleJpeg(), { filename: 'scan.jpg', contentType: 'image/jpeg' });

    let scanId = null;
    if (response.status === 503) {
      expect(response.body.error.code).toBe('AI_UNAVAILABLE');
      scanId = response.body.error.details.scanId;
      expect(scanId).toMatch(/^[0-9a-f-]{36}$/);

      const rows = await query('SELECT status, has_image, error_code FROM scans WHERE id = ?', [scanId]);
      expect(rows[0]).toMatchObject({ status: 'failed', has_image: 1, error_code: 'AI_UNAVAILABLE' });

      const images = await query('SELECT mime_type FROM scan_images WHERE scan_id = ?', [scanId]);
      expect(images).toHaveLength(1);
      expect(images[0].mime_type).toBe('image/jpeg');
    } else {
      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('completed');
      scanId = response.body.data.id;
    }

    if (!scanId) return;
    createdIds.add(scanId);
    const otherSession = await request(app).get(`/api/scans/${scanId}`);
    expect(otherSession.status).toBe(404);
  });

  it('replays the existing scan for a repeated client_scan_id', async () => {
    const payload = await sampleJpeg();
    const agent = request.agent(app);
    const send = () =>
      agent
        .post('/api/scans')
        .field('language', 'en')
        .field('source', 'upload')
        .field('client_scan_id', '22222222-2222-4222-8222-222222222222')
        .attach('image', payload, { filename: 'replay.jpg', contentType: 'image/jpeg' });

    const first = await send();
    const firstId =
      first.status === 503 ? first.body.error.details.scanId : first.body.data?.id ?? null;
    if (firstId) createdIds.add(firstId);

    const second = await send();
    expect(second.status).toBe(200);
    expect(second.body.data.replayed).toBe(true);
    if (firstId) expect(second.body.data.id).toBe(firstId);
  }, 30000);
});
