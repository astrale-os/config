# @astrale-os/config

Shared configurations for Astrale OS TypeScript monorepos.

## Packages

| Package | Description |
|---------|-------------|
| `@astrale-os/eslint-config` | ESLint flat config for TypeScript projects |
| `@astrale-os/typescript-config` | Base tsconfig presets (base, library, app) |
| `@astrale-os/prettier-config` | Prettier formatting rules |
| `@astrale-os/commitlint-config` | Conventional commits with custom scopes |
| `@astrale-os/renovate-config` | Renovate dependency update config |

## Usage

### ESLint

```js
// eslint.config.js
import { createConfig } from '@astrale-os/eslint-config'

export default createConfig({
  testPatterns: ['**/*.test.ts'],
  ignorePatterns: ['server/index.ts'],
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

### Prettier

```json
// package.json
{
  "prettier": "@astrale-os/prettier-config"
}
```

Or in `.prettierrc.js`:
```js
import config from '@astrale-os/prettier-config'
export default config
```

### Commitlint

```js
// commitlint.config.js
import { createConfig } from '@astrale-os/commitlint-config'

export default createConfig({
  scopes: ['server', 'client', 'adapter', 'deps', 'ci']
})
```

### Renovate

```json
// renovate.json
{
  "extends": ["github>astrale-os/config:packages/renovate/default"]
}
```

## Installation

All packages are published to GitHub Packages. Configure npm/pnpm:

```bash
# .npmrc
@astrale-os:registry=https://npm.pkg.github.com
```

Then install:

```bash
pnpm add -D @astrale-os/eslint-config @astrale-os/typescript-config @astrale-os/prettier-config
```
