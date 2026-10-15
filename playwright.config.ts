import { defineConfig, devices } from '@playwright/test'

const base = process.env.PAGES_BASE_PATH ?? '/polar-vocab/'
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './reports/test-results/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: './reports/playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:4173${base}`,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: `http://127.0.0.1:4173${base}`,
    reuseExistingServer: !process.env.CI,
  },
})
