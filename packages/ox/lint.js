import { defineConfig } from 'oxlint'

export default defineConfig({
  rules: {
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    'no-explicit-any': 'warn',
    'consistent-type-imports': 'warn',
    'no-console': 'warn',
    'prefer-const': 'error',
    eqeqeq: ['error', 'always'],
  },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    '**/*.js',
    '**/*.mjs',
    '**/*.cjs',
    '**/*.gen.ts', // generator-owned (TanStack routeTree.gen.ts etc.) — already `/* eslint-disable */`
  ],
  overrides: [
    {
      files: [
        '**/__tests__/**/*.ts',
        '**/*.test.ts',
        '**/*.perf.ts',
        '**/*.bench.ts',
        '**/*.spec.ts',
      ],
      rules: {
        'no-explicit-any': 'off',
        'no-unused-vars': 'off',
        'no-console': 'off',
      },
    },
  ],
})
