import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', workers: 1, fullyParallel: false, timeout: 120_000,
  outputDir: '../../reports/test-results/phase-4/desktop-e2e',
  reporter: [['list'], ['html', { outputFolder: '../../reports/playwright-report/phase-4/desktop', open: 'never' }]],
})
