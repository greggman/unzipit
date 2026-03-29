import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import js from '@eslint/js';

const browserGlobals = {
  console: 'readonly',
  window: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  SharedArrayBuffer: 'readonly',
  ArrayBuffer: 'readonly',
  Worker: 'readonly',
  DecompressionStream: 'readonly',
  crypto: 'readonly',
  btoa: 'readonly',
  self: 'readonly',
  name: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
};

const testGlobals = {
  describe: 'readonly',
  it: 'readonly',
  before: 'readonly',
  after: 'readonly',
  mocha: 'readonly',
  chai: 'readonly',
};

export default [
  {
    ignores: ['test/chai.js', 'test/mocha.js', 'test/ts/ts-test.js', 'dist/**'],
  },
  {
    // JS test/build files
    files: ['test/index.js', 'test/tests/**/*.js', 'test/ts/ts-test.ts', 'test/node-test.js', 'test/puppeteer.js', 'build/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {...browserGlobals, ...nodeGlobals, ...testGlobals},
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-trailing-spaces': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'comma-dangle': ['error', 'always-multiline'],
      'space-before-function-paren': ['error', 'never'],
      'keyword-spacing': ['error', {before: true, after: true}],
    },
  },
  {
    // TypeScript source files
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-var': 'error',
      'prefer-const': 'error',
      'no-trailing-spaces': 'error',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'comma-dangle': ['error', 'always-multiline'],
      'space-before-function-paren': ['error', 'never'],
      'keyword-spacing': ['error', {before: true, after: true}],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
