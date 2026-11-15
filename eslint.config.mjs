import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const TEST_FILES = ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}', '**/*.spec.ts'];

// next's config already registers the jsx-a11y plugin; adding the plugin again would clash,
// so we take only the recommended rule set from it.
const jsxA11yRecommendedRules = jsxA11y.flatConfigs.recommended.rules;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // typescript-eslint strict, type-aware, for TypeScript files only.
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: TS_FILES })),
  {
    files: TS_FILES,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  {
    rules: {
      ...jsxA11yRecommendedRules,

      // Complexity gates (docs/quality-gates.md).
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],

      // Types gate: no any, no @ts-ignore. @ts-expect-error needs a reason.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],

      // Structured logging only (src/lib/log is exempted below).
      'no-console': 'error',

      // Config must be read in one place (src/env.ts), validated with zod.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read environment variables through src/env.ts (zod-validated), never process.env directly.',
        },
      ],
      // The same ban for the forms the rule above can't see: importing env from node:process, an aliased
      // process object, and globalThis.process.env. (Destructuring `const { env } = process` is caught below.)
      'no-restricted-imports': [
        'error',
        {
          paths: ['node:process', 'process'].map((name) => ({
            name,
            message: 'Read environment variables through src/env.ts (zod-validated), never via node:process.',
          })),
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='env'][object.property.name='process']",
          message: 'Read environment variables through src/env.ts (zod-validated), never process.env directly.',
        },
        {
          selector: "VariableDeclarator[init.name='process'][id.type='ObjectPattern']",
          message: 'Do not destructure process; read environment variables through src/env.ts.',
        },
      ],
    },
  },

  // UI components get a bigger function budget (JSX is verbose).
  {
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    rules: {
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },

  // The one <img> wrapper. V&A images are sized by the IIIF server and loaded directly, so next/image would only burn
  // Vercel image-optimisation quota (docs/adr/0002-client-side-image-processing.md). Any other <img> stays flagged.
  {
    files: ['src/app/_components/DesignImage.tsx'],
    rules: { '@next/next/no-img-element': 'off' },
  },

  // The structured logger is the one place allowed to call console.
  {
    files: ['src/lib/log/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Files that legitimately read process.env.
  {
    files: [
      'src/env.ts',
      '*.config.{ts,mjs,js,cjs}',
      'tests/e2e/**/*.ts',
      'tests/contract/**/*.ts',
      '.claude/hooks/**/*.mjs',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },

  // Test code: long describe blocks, fixtures and non-null assertions are normal here.
  {
    files: TEST_FILES,
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // Plain JS/MJS (config files, guardrail hooks) are not part of the TS project: skip type-aware rules.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last: turns off rules that conflict with Prettier.
  prettier,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    'reports/**',
    'playwright-report/**',
    'test-results/**',
    '.stryker-tmp/**',
  ]),
]);

export default eslintConfig;
