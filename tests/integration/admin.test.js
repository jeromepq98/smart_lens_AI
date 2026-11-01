import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../app.js';
import { closePool, query } from '../../config/db.js';

const app = createApp();
const TEST_PASSWORD = 'integration-admin-password-123';

let agent;
let csrf = '';
let adminId = 1;

beforeAll(async () => {
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  await query(
    `UPDATE admin_users
     SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL
     WHERE username = 'admin'`,
    [hash],
  );
  const rows = await query("SELECT id FROM admin_users WHERE username = 'admin'");
  adminId = rows[0].id;
  await query('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId]);
});

afterAll(async () => {
  await query('UPDATE admin_users SET must_change_password = 1 WHERE id = ?', [adminId]);
  await query('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId]);
  await closePool();
});

describe('admin authentication and CSRF', () => {
  it('rejects unauthenticated access to admin endpoints', async () => {
    const response = await request(app).get('/api/admin/dashboard');
    expect(response.status).toBe(401);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const response = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'definitely-not-the-password' });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Incorrect username or password.');
  });

  it('signs in, sets an httpOnly session cookie and a readable CSRF cookie', async () => {
    agent = request.agent(app);
    const response = await agent
      .post('/api/admin/login')
      .send({ username: 'admin', password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.admin.mustChangePassword).toBe(true);
    csrf = response.body.data.csrf;
    expect(csrf).toMatch(/^[0-9a-f]{64}$/);

    const cookies = response.headers['set-cookie'].join(';');
    expect(cookies).toContain('sl_admin=s%3A');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('sl_admin_csrf=');
  });

  it('returns the real admin user id from the session', async () => {
    const response = await agent.get('/api/admin/me');
    expect(response.status).toBe(200);
    expect(response.body.data.admin.id).toBe(adminId);
  });

  it('blocks console access until the initial password is changed', async () => {
    const response = await agent.get('/api/admin/dashboard');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    await query('UPDATE admin_users SET must_change_password = 0 WHERE id = ?', [adminId]);
    const response = await agent
      .put('/api/admin/settings')
      .send({ system: { appVersion: '1.0.0' } });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a state-changing request with the wrong CSRF token', async () => {
    const response = await agent
      .put('/api/admin/settings')
      .set('X-CSRF-Token', 'f'.repeat(64))
      .send({ system: { appVersion: '1.0.0' } });
    expect(response.status).toBe(403);
  });

  it('accepts a settings update with a valid CSRF token and never returns secrets', async () => {
    const response = await agent
      .put('/api/admin/settings')
      .set('X-CSRF-Token', csrf)
      .send({ system: { appVersion: '1.0.0' } });

    expect(response.status).toBe(200);
    expect(response.body.data.ai).toMatchObject({ hasApiKey: false, apiKeySource: 'none' });
    expect(JSON.stringify(response.body)).not.toContain('apiKeyEnc');

    const audit = await query(
      "SELECT action FROM audit_logs WHERE admin_id = ? AND action = 'settings_updated' ORDER BY id DESC LIMIT 1",
      [adminId],
    );
    expect(audit).toHaveLength(1);
  });

  it('exposes dashboard metrics to an authenticated admin', async () => {
    const response = await agent.get('/api/admin/dashboard');
    expect(response.status).toBe(200);
    expect(response.body.data.system.aiConfigured).toBe(false);
    expect(response.body.data.scans).toBeTypeOf('object');
  });

  it('invalidates the session on logout', async () => {
    const response = await agent.post('/api/admin/logout').set('X-CSRF-Token', csrf);
    expect(response.status).toBe(204);

    const me = await agent.get('/api/admin/me');
    expect(me.status).toBe(401);
  });
});
