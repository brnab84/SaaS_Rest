import { defineConfig } from '@playwright/test';

// Smoke de UI (Capa 2 del QA): levanta el servidor de prueba y recorre panel + storefront.
export default defineConfig({
  testDir: './tests-ui',
  timeout: 30000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', headless: true },
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
