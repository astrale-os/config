# @astrale/config

Shared configurations and composite actions for Astrale TypeScript monorepos.

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

## Actions

Composite actions organized by category in `.github/actions/`.

```
.github/actions/
├── setup/           # pnpm + Node.js + install
├── ci/              # lint, typecheck, test, build
├── publish/
│   ├── jsr/         # Publish to JSR
│   └── npm/         # Publish to npm/GitHub Packages
└── release/         # Release Please
```

### setup

Setup pnpm, Node.js, and install dependencies.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: astrale-os/config/.github/actions/setup@main
```

| Input               | Default  | Description               |
| ------------------- | -------- | ------------------------- |
| `node-version-file` | `.nvmrc` | Path to Node version file |

### ci

Run lint, typecheck, test, and build.

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astrale-os/config/.github/actions/ci@main
        with:
          run-test: 'false' # optional
```

| Input                  | Default             | Description               |
| ---------------------- | ------------------- | ------------------------- |
| `node-version-file`    | `.nvmrc`            | Path to Node version file |
| `run-lint`             | `true`              | Run ESLint and Prettier   |
| `run-typecheck`        | `true`              | Run TypeScript checks     |
| `run-test`             | `true`              | Run tests                 |
| `run-build`            | `true`              | Run build                 |
| `lint-command`         | `pnpm lint`         | Lint command              |
| `format-check-command` | `pnpm format:check` | Format check command      |
| `typecheck-command`    | `pnpm typecheck`    | Typecheck command         |
| `test-command`         | `pnpm test`         | Test command              |
| `build-command`        | `pnpm build`        | Build command             |

### publish/jsr

Publish a package to JSR with OIDC authentication.

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astrale-os/config/.github/actions/publish/jsr@main
```

| Input               | Default  | Description                   |
| ------------------- | -------- | ----------------------------- |
| `node-version-file` | `.nvmrc` | Path to Node version file     |
| `allow-slow-types`  | `true`   | Allow slow types in JSR       |
| `working-directory` | `.`      | Directory containing jsr.json |

### publish/npm

Publish packages to npm or GitHub Packages.

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astrale-os/config/.github/actions/publish/npm@main
        with:
          scope: '@astrale-os'
          token: ${{ github.token }}
```

| Input               | Default                      | Description                     |
| ------------------- | ---------------------------- | ------------------------------- |
| `node-version-file` | `.nvmrc`                     | Path to Node version file       |
| `registry-url`      | `https://npm.pkg.github.com` | npm registry URL                |
| `scope`             | required                     | npm scope (e.g., `@astrale-os`) |
| `access`            | `restricted`                 | Package access level            |
| `token`             | required                     | npm registry token              |

### release

Automated versioning with Release Please.

```yaml
permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astrale-os/config/.github/actions/release@main
        with:
          token: ${{ github.token }}
```

| Input   | Default  | Description                       |
| ------- | -------- | --------------------------------- |
| `token` | required | GitHub token for releases and PRs |

**Outputs:** `releases_created`, `paths_released`
