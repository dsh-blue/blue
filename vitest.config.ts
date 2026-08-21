import { defineConfig } from 'vitest/config'

// Source-plane tests: specs import the package under test through relative
// ../src/*.ts paths; every @deepseek-ai/* runtime dependency resolves from
// node_modules (pnpm workspace links + the npm registry).
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/bundle/*/tests/**/*.spec.ts'],
    // Forked workers avoid Node 24's worker-thread CJS lexer crashes.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'packages/bundle/*/src/**/*.ts'],
      // Types-only files carry no executable code. The s33-debug row is the
      // temporary dogfood verification plugin — excluded while it exists and
      // removed with it before merge (D37).
      exclude: ['packages/*/src/types.ts', 'packages/bundle/*/src/types.ts', 'packages/transcript/src/s33-debug.ts'],
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: ['text', 'html'],
    },
  },
})
