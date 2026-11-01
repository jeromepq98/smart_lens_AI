import { expect, test } from '@playwright/test';

test.describe('public application', () => {
  test('renders the scanner home and switches language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.source-panel')).toBeVisible();
    await expect(page.locator('#openCamera')).toBeVisible();
    await expect(page.locator('#openUpload')).toBeVisible();

    await page.selectOption('#languageSelect', 'fil');
    await expect(page.locator('a[data-nav="history"]').first()).toContainText('Kasaysayan');
    await expect(page.locator('a[data-nav="settings"]').first()).toContainText('Mga Setting');
  });

  test('toggles the theme and remembers it after a reload', async ({ page }) => {
    await page.goto('/');
    await page.click('#themeToggle');
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
  });

  test('serves the shell offline and queues a scan until the connection returns', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cacheEntries = await page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = keys.find((key) => key.startsWith('smartlens-shell-'));
      return shell ? (await (await caches.open(shell)).keys()).length : 0;
    });
    expect(cacheEntries).toBeGreaterThanOrEqual(20);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#offlineBanner')).toBeVisible();
    await expect(page.locator('.source-panel')).toBeVisible();

    const queued = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 240;
      canvas.getContext('2d').fillRect(0, 0, 240, 240);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      const sync = await import('/js/sync.js');
      const record = await sync.submitScan({ blob, filename: 'e2e-offline.jpg', language: 'en', source: 'upload' });
      return { id: record.id, status: record.status };
    });
    expect(queued.status).toBe('pending');
    await expect(page.locator('#syncBadge')).toBeVisible();
    await expect(page.locator('#syncBadgeCount')).toHaveText('1');

    await context.setOffline(false);
    const synced = await page.evaluate(async (id) => {
      const sync = await import('/js/sync.js');
      const db = await import('/js/db.js');
      await sync.syncNow({ silent: true });
      let record = await db.getScan(id);
      for (let i = 0; i < 60; i += 1) {
        record = await db.getScan(id);
        if (record?.serverId && record.status !== 'pending') break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (record?.serverId) {
        await fetch(`/api/scans/${record.serverId}`, { method: 'DELETE', credentials: 'same-origin' });
      }
      return record;
    }, queued.id);
    expect(synced.serverId).toBeTruthy();
    expect(['failed', 'completed']).toContain(synced.status);
    if (synced.status === 'failed') expect(synced.errorCode).toBe('AI_UNAVAILABLE');
    await expect(page.locator('#syncBadge')).toBeHidden();
  });
});
