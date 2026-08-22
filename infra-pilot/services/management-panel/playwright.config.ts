import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev:backend',
      url: 'http://localhost:3001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key',
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://localhost:54321',
        VITE_DEMO_FEATURE_ENABLED: process.env.VITE_DEMO_FEATURE_ENABLED || 'false',
      },
    },
    {
      command: 'npm run dev:frontend -- --host 127.0.0.1',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'Chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
