import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the real production build against scripts/mock-supabase.mjs (fictional
// data, never the real project). `npm run e2e` builds first; CI runs this before every deploy.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1, // one shared mock database
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4331/Sidequest/',
    timezoneId: 'Europe/Warsaw',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'node scripts/mock-supabase.mjs', url: 'http://127.0.0.1:54321/rest/v1/spaces', reuseExistingServer: !process.env.CI },
    { command: 'node scripts/serve-static.mjs .e2e-dist 4331 /Sidequest', url: 'http://127.0.0.1:4331/Sidequest/', reuseExistingServer: !process.env.CI },
  ],
});
