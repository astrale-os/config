# @astrale-os/config

Shared configurations for Astrale OS TypeScript monorepos.

## Packages

| Package | JSR | Description |
|---------|-----|-------------|
| `@astrale-os/eslint-config` | [![JSR](https://jsr.io/badges/@astrale-os/eslint-config)](https://jsr.io/@astrale-os/eslint-config) | ESLint flat config for TypeScript |
| `@astrale-os/typescript-config` | [![JSR](https://jsr.io/badges/@astrale-os/typescript-config)](https://jsr.io/@astrale-os/typescript-config) | Base tsconfig presets |
| `@astrale-os/prettier-config` | [![JSR](https://jsr.io/badges/@astrale-os/prettier-config)](https://jsr.io/@astrale-os/prettier-config) | Prettier formatting rules |
| `@astrale-os/commitlint-config` | [![JSR](https://jsr.io/badges/@astrale-os/commitlint-config)](https://jsr.io/@astrale-os/commitlint-config) | Conventional commits config |
| `@astrale-os/renovate-config` | — | Renovate dependency updates |

## Installation

```bash
# pnpm
pnpm add -D jsr:@astrale-os/eslint-config jsr:@astrale-os/typescript-config jsr:@astrale-os/prettier-config jsr:@astrale-os/commitlint-config

# npm
npx jsr add -D @astrale-os/eslint-config @astrale-os/typescript-config @astrale-os/prettier-config @astrale-os/commitlint-config
```

## Usage

### ESLint

```js
// eslint.config.js
import { createConfig } from '@astrale-os/eslint-config'

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  testPatterns: ['**/*.test.ts'],
  ignorePatterns: ['some/file.ts'],
})
```

### TypeScript

```json
// tsconfig.json
{
  "extends": "@astrale-os/typescript-config/library",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

Available presets:
- `@astrale-os/typescript-config/base` — Base strict config
- `@astrale-os/typescript-config/library` — For publishable libraries
- `@astrale-os/typescript-config/app` — For applications (noEmit)

### Prettier

```json
// package.json
{
  "prettier": "@astrale-os/prettier-config"
}
```

Or in a config file:

```js
// prettier.config.js
import config from '@astrale-os/prettier-config'
export default config
```

### Commitlint

```js
// commitlint.config.js
import { createConfig } from '@astrale-os/commitlint-config'

export default createConfig({
  scopes: ['server', 'client', 'adapter', 'deps', 'ci'],
})
```

### Renovate

```json
// renovate.json
{
  "extends": ["github>astrale-os/config:packages/renovate/default"]
}
```

## Configuration Options

### ESLint

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tsconfigRootDir` | `string` | — | Root directory for TypeScript (enables type-aware linting) |
| `testPatterns` | `string[]` | `['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.perf.ts']` | Glob patterns for test files (relaxed rules) |
| `ignorePatterns` | `string[]` | `[]` | Additional patterns to ignore |

### Commitlint

| Option | Type | Description |
|--------|------|-------------|
| `scopes` | `string[]` | Allowed commit scopes for this project |

## Prettier Rules

- `semi: false` — No semicolons
- `singleQuote: true` — Single quotes
- `trailingComma: 'all'` — Trailing commas everywhere
- `printWidth: 100` — Line width
- `tabWidth: 2` — 2 spaces

## TypeScript Base Config

- `target: ES2022`
- `module: ESNext`
- `moduleResolution: bundler`
- `strict: true`
- `verbatimModuleSyntax: true`
