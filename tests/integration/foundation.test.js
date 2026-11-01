import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { closePool, query } from '../../config/db.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('application foundation', () => {
  it('reports liveness without issuing an anonymous session', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.version).toBe('1.0.0');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('reports readiness with a live database connection', async () => {
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ready', database: 'up' });
  });

  it('sets a signed, httpOnly anonymous session cookie', async () => {
    const response = await request(app).get('/api/not-a-real-route');
    expect(response.status).toBe(404);
    const cookies = response.headers['set-cookie'] || [];
    const sessionCookie = cookies.find((cookie) => cookie.startsWith('sl_sid='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('s%3A');
  });

  it('replaces an invalid or tampered signed cookie', async () => {
    const response = await request(app)
      .get('/api/not-a-real-route')
      .set('Cookie', 'sl_sid=s%3Atampered-value.invalid-signature');
    const cookies = response.headers['set-cookie'] || [];
    expect(cookies.some((cookie) => cookie.startsWith('sl_sid='))).toBe(true);
  });

  it('returns a structured 404 envelope with a request id', async () => {
    const response = await request(app).get('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('rejects malformed JSON with a validation-safe error', async () => {
    const response = await request(app)
      .post('/api/scans')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('applies security headers', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['permissions-policy']).toContain('camera=(self)');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('seeded reference data', () => {
  it('seeds nine categories', async () => {
    const rows = await query('SELECT COUNT(*) AS count FROM categories');
    expect(Number(rows[0].count)).toBe(9);
  });

  it('seeds system settings and one administrator', async () => {
    const settings = await query('SELECT COUNT(*) AS count FROM system_settings');
    const admins = await query('SELECT COUNT(*) AS count FROM admin_users');
    expect(Number(settings[0].count)).toBeGreaterThanOrEqual(10);
    expect(Number(admins[0].count)).toBe(1);
  });

  it('stores the current application version', async () => {
    const rows = await query('SELECT version FROM app_versions WHERE is_current = 1');
    expect(rows.map((row) => row.version)).toContain('1.0.0');
  });
});
