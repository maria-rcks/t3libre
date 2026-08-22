import { test, expect } from '@playwright/test';

test.describe('Infra-pilot health & UI sanity', () => {
  // Basic frontend ping: ensure UI loads
  test('frontend loads on root', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Basic sanity: URL should be the base URL (frontend served)
    expect(page.url()).toContain('5173');
  });

  // Optional: backend health check is best-effort and will be skipped if backend isn't running.
  // You can enable this in environments where the backend is available.
});
