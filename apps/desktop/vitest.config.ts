import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['apps/desktop/tests/**/*.test.ts'], restoreMocks: true } })
