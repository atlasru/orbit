import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 20000, fullyParallel: true, workers: 2,
  use: { baseURL: 'http://127.0.0.1:1420', viewport: { width: 1120, height: 740 }, channel: process.platform === 'win32' ? 'msedge' : undefined, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: false, timeout: 15000 },
});
