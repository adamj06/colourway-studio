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
      // Only the UI files are excluded: route handlers (src/app/api/**/route.ts) hold the SSRF allowlist, the
      // health check and the typed error JSON, so they stay inside the coverage gate.
      exclude: [
        'src/app/**/*.tsx',
        'src/app/**/{layout,page,error,not-found,loading,template,default}.ts',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        'src/lib/**': { lines: 95, branches: 95 },
      },
    },
  },
});
