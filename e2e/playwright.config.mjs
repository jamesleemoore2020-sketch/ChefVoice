import { defineConfig, devices } from '@playwright/test';

// The PWA is served from web/ by serve.mjs, which behaves like the Hosting "pwa" target.
// Every spec keeps Firebase unreachable (see fixtures.mjs), so nothing here can read from or
// write to the production project, and the app runs exactly as it does offline.
const PORT = Number(process.env.E2E_PORT || 4174);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // A phone, since that is where ChefVoice is used: 375 wide, touch, mobile viewport.
    ...devices['Pixel 5'],
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node serve.mjs',
    env: { PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
