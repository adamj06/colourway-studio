// Mutation testing, scoped to the pure colour code where the bugs would be (docs/quality-gates.md).
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const strykerConfig = {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' },
  mutate: ['src/lib/colour/**/*.ts', '!src/lib/colour/**/*.test.ts', '!src/lib/colour/**/*.d.ts'],
  // Keep build output and reports out of the sandbox copy.
  ignorePatterns: ['.next', 'coverage', 'reports', 'playwright-report', 'test-results'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // break: the run fails below 80. high/low only colour the report.
  thresholds: { high: 90, low: 80, break: 80 },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};

export default strykerConfig;
