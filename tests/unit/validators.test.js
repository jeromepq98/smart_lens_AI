import { describe, expect, it } from 'vitest';
import { adminSettingsSchema } from '../../validators/admin.js';
import { createScanSchema, listScansQuerySchema } from '../../validators/scan.js';

describe('scan validation', () => {
  it('requires a UUID client_scan_id and a supported language', () => {
    expect(
      createScanSchema.safeParse({
        client_scan_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        language: 'fil',
        source: 'camera',
      }).success,
    ).toBe(true);

    expect(
      createScanSchema.safeParse({
        client_scan_id: 'not-a-uuid',
        language: 'en',
        source: 'camera',
      }).success,
    ).toBe(false);

    expect(
      createScanSchema.safeParse({
        client_scan_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        language: 'fr',
        source: 'camera',
      }).success,
    ).toBe(false);
  });

  it('clamps list limits and rejects unknown categories', () => {
    expect(listScansQuerySchema.parse({}).limit).toBe(20);
    expect(listScansQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(listScansQuerySchema.safeParse({ category: 'Bad Slug' }).success).toBe(false);
  });
});

describe('admin settings validation', () => {
  it('accepts a partial settings payload', () => {
    const result = adminSettingsSchema.safeParse({
      branding: { title: 'SmartLens AI', theme: { primary: '#0f9d76', accent: '#0f766e' } },
      limits: { dailyScans: 25 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown sections and unsafe values', () => {
    expect(adminSettingsSchema.safeParse({ unknown: { value: 1 } }).success).toBe(false);
    expect(
      adminSettingsSchema.safeParse({ branding: { theme: { primary: 'teal' } } }).success,
    ).toBe(false);
    expect(adminSettingsSchema.safeParse({ branding: { logoUrl: 'javascript:alert(1)' } }).success).toBe(
      false,
    );
    expect(adminSettingsSchema.safeParse({ branding: { logoUrl: 'http://insecure.example/x.png' } }).success).toBe(
      false,
    );
    expect(adminSettingsSchema.safeParse({ limits: { dailyScans: 0 } }).success).toBe(false);
    expect(
      adminSettingsSchema.safeParse({ upload: { allowedTypes: ['image/svg+xml'] } }).success,
    ).toBe(false);
  });

  it('rejects API keys that exceed the allowed length', () => {
    expect(adminSettingsSchema.safeParse({ ai: { apiKey: 'k'.repeat(401) } }).success).toBe(false);
  });
});
