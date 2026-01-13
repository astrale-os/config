import type { Config } from 'typescript-eslint'

export interface ConfigOptions {
  /** Root directory for TypeScript config (required for type-aware linting) */
  tsconfigRootDir?: string
  /** Glob patterns for test files (default: ['**\/__tests__/**\/*.ts', '**\/*.test.ts', '**\/*.perf.ts']) */
  testPatterns?: string[]
  /** Additional patterns to ignore */
  ignorePatterns?: string[]
}

/**
 * Creates a base ESLint configuration for Astrale OS TypeScript projects.
 */
export function createConfig(options?: ConfigOptions): Config

export default createConfig
