import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: ['text'],
    },
  },
})
