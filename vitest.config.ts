import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', '.stryker-tmp/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // UI (src/app) is measured by e2e + axe, not by chasing line counts on JSX (docs/quality-gates.md).
      exclude: ['src/app/**', '**/*.test.{ts,tsx}', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        'src/lib/**': { lines: 95, branches: 95 },
      },
    },
  },
});
