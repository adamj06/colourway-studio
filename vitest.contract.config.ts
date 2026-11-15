import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Live V&A contract check: hits the real API, so it is kept out of the unit-test run.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
