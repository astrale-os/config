import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

/**
 * Creates a base ESLint configuration for Astrale OS TypeScript projects.
 *
 * @param {Object} [options] - Configuration options
 * @param {string} [options.tsconfigRootDir] - Root directory for TypeScript config (required for type-aware linting)
 * @param {string[]} [options.testPatterns] - Glob patterns for test files
 * @param {string[]} [options.ignorePatterns] - Additional patterns to ignore
 * @returns {import('typescript-eslint').Config}
 */
export function createConfig(options = {}) {
  const {
    tsconfigRootDir,
    testPatterns = ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.perf.ts'],
    ignorePatterns = [],
  } = options

  const baseConfig = [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
  ]

  // Only add type-aware config if tsconfigRootDir is provided
  if (tsconfigRootDir) {
    baseConfig.push({
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
    })
  }

  return tseslint.config(
    ...baseConfig,
    {
      rules: {
        // TypeScript rules - pragmatic defaults
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/consistent-type-imports': [
          'warn',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],

        // General rules
        'no-console': 'warn',
        'no-control-regex': 'off',
        'prefer-const': 'error',
        eqeqeq: ['error', 'always'],
      },
    },
    {
      // More permissive rules for test files
      files: testPatterns,
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'no-console': 'off',
      },
    },
    {
      // Default ignore patterns
      ignores: [
        '**/dist/**',
        '**/node_modules/**',
        '**/coverage/**',
        '**/*.js',
        '**/*.mjs',
        '**/*.cjs',
        'eslint.config.js',
        '**/vitest.config.ts',
        ...ignorePatterns,
      ],
    },
  )
}

export default createConfig
