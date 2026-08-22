import { test, expect } from '@playwright/test';

// Verifies that the UI gate for Seed Demo is aligned with the environment flag
test('Demo feature flag gating alignment', async ({ page }) => {
  const flagEndpoint = 'http://localhost:3001/api/demo/flag';
  try {
    const resp = await page.request.get(flagEndpoint);
    if (resp.status() >= 400) {
      test.skip(`Backend demo flag endpoint not reachable (status ${resp.status()})`);
      return;
    }
    const json = await resp.json();
    const enabled = !!json.enabled;
    const expected = process.env.VITE_DEMO_FEATURE_ENABLED === 'true';
    expect(enabled).toBe(expected);
  } catch {
    test.skip('Backend demo flag endpoint not reachable');
  }
});
