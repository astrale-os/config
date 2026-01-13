# @astrale/config

Shared configurations and callable workflows for Astrale TypeScript monorepos.

## Packages

| Package                      | JSR                                                                                                   | Description                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@astrale/eslint-config`     | [![JSR](https://jsr.io/badges/@astrale/eslint-config)](https://jsr.io/@astrale/eslint-config)         | ESLint flat config for TypeScript |
| `@astrale/typescript-config` | [![JSR](https://jsr.io/badges/@astrale/typescript-config)](https://jsr.io/@astrale/typescript-config) | Base tsconfig presets             |
| `@astrale/prettier-config`   | [![JSR](https://jsr.io/badges/@astrale/prettier-config)](https://jsr.io/@astrale/prettier-config)     | Prettier formatting rules         |
| `@astrale/commitlint-config` | [![JSR](https://jsr.io/badges/@astrale/commitlint-config)](https://jsr.io/@astrale/commitlint-config) | Conventional commits config       |
| `@astrale/renovate-config`   | —                                                                                                     | Renovate dependency updates       |

## Installation

Requires **pnpm 10.9+** for native JSR support.

```bash
pnpm add -D jsr:@astrale/eslint-config jsr:@astrale/typescript-config jsr:@astrale/prettier-config jsr:@astrale/commitlint-config
```

## Config Usage

### ESLint

```js
// eslint.config.js
import { createConfig } from '@astrale/eslint-config'

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  testPatterns: ['**/*.test.ts'],
  ignorePatterns: ['some/file.ts'],
})
```

### TypeScript

```json
{
  "extends": "@astrale/typescript-config/library",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

Presets: `/base`, `/library`, `/app`

### Prettier

```json
{ "prettier": "@astrale/prettier-config" }
```

### Commitlint

```js
// commitlint.config.js
import { createConfig } from '@astrale/commitlint-config'

export default createConfig({
  scopes: ['server', 'client', 'deps', 'ci'],
})
```

### Renovate

```json
{ "extends": ["github>astrale-os/config:packages/renovate/default"] }
```

---

## Workflows

Callable workflows organized by category in `.github/workflows/`.

```
.github/workflows/
├── ci/
│   └── default.yml      # Lint, typecheck, test, build
├── publish/
│   ├── jsr.yml          # Publish to JSR
│   └── npm.yml          # Publish to npm/GitHub Packages
└── release/
    └── default.yml      # Release Please
```

### ci/default.yml

Full CI pipeline with lint, typecheck, test, and build.

```yaml
jobs:
  ci:
    uses: astrale-os/config/.github/workflows/ci/default.yml@main
    with:
      run-lint: true
      run-typecheck: true
      run-test: true
      run-build: true
```

| Input                  | Type    | Default             | Description               |
| ---------------------- | ------- | ------------------- | ------------------------- |
| `node-version-file`    | string  | `.nvmrc`            | Path to Node version file |
| `run-lint`             | boolean | `true`              | Run ESLint and Prettier   |
| `run-typecheck`        | boolean | `true`              | Run TypeScript checks     |
| `run-test`             | boolean | `true`              | Run tests                 |
| `run-build`            | boolean | `true`              | Run build                 |
| `lint-command`         | string  | `pnpm lint`         | Lint command              |
| `format-check-command` | string  | `pnpm format:check` | Format check command      |
| `typecheck-command`    | string  | `pnpm typecheck`    | Typecheck command         |
| `test-command`         | string  | `pnpm test`         | Test command              |
| `build-command`        | string  | `pnpm build`        | Build command             |
| `commitlint-command`   | string  | `pnpm commitlint`   | Commitlint command        |

### publish/jsr.yml

Publish packages to JSR with OIDC authentication.

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  publish:
    uses: astrale-os/config/.github/workflows/publish/jsr.yml@main
    with:
      packages: '["packages/foo", "packages/bar"]'
```

| Input               | Type    | Default  | Description                       |
| ------------------- | ------- | -------- | --------------------------------- |
| `packages`          | string  | required | JSON array of package directories |
| `node-version-file` | string  | `.nvmrc` | Path to Node version file         |
| `allow-slow-types`  | boolean | `true`   | Allow slow types in JSR           |

### publish/npm.yml

Publish packages to npm or GitHub Packages.

```yaml
jobs:
  publish:
    uses: astrale-os/config/.github/workflows/publish/npm.yml@main
    with:
      scope: '@astrale-os'
      access: 'restricted'
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }} # optional for GitHub Packages
```

| Input               | Type   | Default                      | Description                     |
| ------------------- | ------ | ---------------------------- | ------------------------------- |
| `node-version-file` | string | `.nvmrc`                     | Path to Node version file       |
| `registry-url`      | string | `https://npm.pkg.github.com` | npm registry URL                |
| `scope`             | string | required                     | npm scope (e.g., `@astrale-os`) |
| `access`            | string | `restricted`                 | Package access level            |

### release/default.yml

Automated versioning with Release Please.

```yaml
jobs:
  release:
    uses: astrale-os/config/.github/workflows/release/default.yml@main
```

| Input           | Type   | Default                         | Description        |
| --------------- | ------ | ------------------------------- | ------------------ |
| `config-file`   | string | `.release-please-config.json`   | Config file path   |
| `manifest-file` | string | `.release-please-manifest.json` | Manifest file path |

**Outputs:** `releases_created`, `paths_released`
