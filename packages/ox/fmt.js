import { defineConfig } from 'oxfmt'

export default defineConfig({
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  // Generated files (e.g. TanStack Router `routeTree.gen.ts`) are owned by their
  // generator — formatting them re-sorts imports and creates an endless diff
  // ping-pong against each regen. The files themselves ask to be excluded.
  ignorePatterns: [
    '*.min.js',
    '*.min.css',
    '*.tsbuildinfo',
    '**/*.md',
    '**/*.gen.ts',
    '**/*.gen.tsx',
  ],
  sortImports: {
    groups: [
      'type-import',
      ['value-builtin', 'value-external'],
      'type-internal',
      'value-internal',
      ['type-parent', 'type-sibling', 'type-index'],
      ['value-parent', 'value-sibling', 'value-index'],
      'unknown',
    ],
  },
})
