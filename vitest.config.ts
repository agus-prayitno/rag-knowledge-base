import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8', reporter: ['text', 'html', 'lcov'],
      include: ['apps/api/src/**', 'packages/domain/src/**', 'apps/ui/src/**'],
      exclude: ['**/*.d.ts', '**/*.test.*'],
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 70 },
    },
  },
});
