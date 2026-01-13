# @astrale-os/config

Shared configurations and reusable workflows for Astrale OS TypeScript monorepos.

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

## Config Usage

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
{
  "extends": "@astrale-os/typescript-config/library",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

Presets: `/base`, `/library`, `/app`

### Prettier

```json
{ "prettier": "@astrale-os/prettier-config" }
```

### Commitlint

```js
// commitlint.config.js
import { createConfig } from '@astrale-os/commitlint-config'

export default createConfig({
  scopes: ['server', 'client', 'deps', 'ci'],
})
```

### Renovate

```json
{ "extends": ["github>astrale-os/config:packages/renovate/default"] }
```

---

## Reusable Workflows

### CI Workflow

Full CI pipeline with lint, typecheck, test, and build.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    uses: astrale-os/config/.github/workflows/reusable-ci.yml@main
    with:
      # All inputs are optional with sensible defaults
      run-lint: true
      run-typecheck: true
      run-test: true
      run-build: true
```

**Inputs:**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `node-version-file` | string | `.nvmrc` | Path to Node version file |
| `run-lint` | boolean | `true` | Run ESLint and Prettier |
| `run-typecheck` | boolean | `true` | Run TypeScript checks |
| `run-test` | boolean | `true` | Run tests |
| `run-build` | boolean | `true` | Run build |
| `lint-command` | string | `pnpm lint` | Lint command |
| `format-check-command` | string | `pnpm format:check` | Format check command |
| `typecheck-command` | string | `pnpm typecheck` | Typecheck command |
| `test-command` | string | `pnpm test` | Test command |
| `build-command` | string | `pnpm build` | Build command |
| `commitlint-command` | string | `pnpm commitlint` | Commitlint command |

### Publish to JSR

Publish packages to JSR registry with OIDC authentication.

```yaml
# .github/workflows/publish-jsr.yml
name: Publish to JSR

on:
  push:
    branches: [main]
    paths:
      - 'packages/*/jsr.json'
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    uses: astrale-os/config/.github/workflows/reusable-publish-jsr.yml@main
    with:
      packages: '["packages/foo", "packages/bar"]'
```

**Inputs:**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `packages` | string | required | JSON array of package directories |
| `node-version-file` | string | `.nvmrc` | Path to Node version file |
| `allow-slow-types` | boolean | `true` | Allow slow types in JSR |

### Publish to npm/GitHub Packages

Publish packages to npm or GitHub Packages registry.

```yaml
# .github/workflows/publish-npm.yml
name: Publish to GitHub Packages

on:
  push:
    branches: [main]
    paths:
      - '.release-please-manifest.json'
  workflow_dispatch:

jobs:
  publish:
    uses: astrale-os/config/.github/workflows/reusable-publish-npm.yml@main
    with:
      scope: '@astrale-os'
      access: 'restricted'  # or 'public' for npm
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}  # optional, defaults to GITHUB_TOKEN
```

**Inputs:**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `node-version-file` | string | `.nvmrc` | Path to Node version file |
| `registry-url` | string | `https://npm.pkg.github.com` | npm registry URL |
| `scope` | string | required | npm scope (e.g., `@astrale-os`) |
| `access` | string | `restricted` | Package access level |

### Release Please

Automated versioning and changelog generation.

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  release:
    uses: astrale-os/config/.github/workflows/reusable-release.yml@main
    with:
      config-file: '.release-please-config.json'
      manifest-file: '.release-please-manifest.json'
```

**Outputs:**

| Output | Description |
|--------|-------------|
| `releases_created` | Whether any releases were created |
| `paths_released` | JSON array of released paths |

---

## Configuration Reference

### Prettier Rules

- `semi: false`
- `singleQuote: true`
- `trailingComma: 'all'`
- `printWidth: 100`
- `tabWidth: 2`

### TypeScript Base Config

- `target: ES2022`
- `module: ESNext`
- `moduleResolution: bundler`
- `strict: true`
- `verbatimModuleSyntax: true`
