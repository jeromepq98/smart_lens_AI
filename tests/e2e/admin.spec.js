import { expect, test } from '@playwright/test';

const password = process.env.ADMIN_INITIAL_PASSWORD || '';

test.describe('administrator console', () => {
  test.skip(!password, 'ADMIN_INITIAL_PASSWORD is not set');

  test('signs in and enforces the initial password change gate', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#loginForm')).toBeVisible();

    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', password);
    await page.click('#loginButton');

    await expect(page.locator('#passwordForm')).toBeVisible();
    await expect(page.locator('.admin-nav')).toHaveCount(0);
    await expect(page.locator('#adminView')).toContainText('initial administrator password');

    await page.click('#logoutButton');
    await expect(page.locator('#loginForm')).toBeVisible();
    const status = await page.evaluate(async () => (await fetch('/api/admin/me', { cache: 'no-store' })).status);
    expect(status).toBe(401);
  });

  test('rejects unknown credentials without creating a session', async ({ page }) => {
    await page.goto('/admin');
    await page.fill('#loginUsername', 'e2e-unknown-user');
    await page.fill('#loginPassword', 'definitely-wrong-password');
    await page.click('#loginButton');
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginError')).toContainText('Incorrect username or password.');
    const status = await page.evaluate(async () => (await fetch('/api/admin/me', { cache: 'no-store' })).status);
    expect(status).toBe(401);
  });
});
