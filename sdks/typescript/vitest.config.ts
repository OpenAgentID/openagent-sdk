import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Tests exercise the in-memory backends from their sibling source so no
      // build step is needed before vitest. Consumers take the built package.
      '@openagentid/sdk-testing': fileURLToPath(
        new URL('../testing/src/index.ts', import.meta.url),
      ),
      // The testing package imports '@openagentid/sdk'; mapping it to this
      // package's source keeps error classes identical across the boundary
      // (a dist/src split would make `instanceof` fail for the same class).
      '@openagentid/sdk': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 10_000,
  },
});
