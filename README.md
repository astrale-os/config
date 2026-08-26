# @astrale/config

Shared configurations and composite actions for Astrale TypeScript monorepos.

Repository-level GitHub merge policy is declared and reconciled from
[`github/repository-policy`](github/repository-policy/README.md).

## Packages

| Package                      | JSR                                                                                                   | Description                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| `@astrale-os/ox`             | —                                                                                                     | oxlint + oxfmt CLI wrapper  |
| `@astrale/typescript-config` | [![JSR](https://jsr.io/badges/@astrale/typescript-config)](https://jsr.io/@astrale/typescript-config) | Base tsconfig presets       |
| `@astrale/commitlint-config` | [![JSR](https://jsr.io/badges/@astrale/commitlint-config)](https://jsr.io/@astrale/commitlint-config) | Conventional commits config |
| `@astrale/renovate-config`   | —                                                                                                     | Renovate dependency updates |

## Installation

Development defaults to **Node.js 26.7.0** and also supports Node.js 24. pnpm
**11.13.1** is required.

```bash
pnpm add -D jsr:@astrale/typescript-config jsr:@astrale/commitlint-config
```

## Config Usage

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

The examples below pin the qualified Config action revision. Keep this revision immutable; never
replace it with a branch such as `main`.

```
.github/actions/
├── setup/           # pnpm + Node.js + install
├── ci/              # lint, typecheck, test, build
├── publish/
│   ├── jsr/         # Publish to JSR
│   ├── npm/         # Publish to one npm-compatible registry
│   └── mirror-npm-to-github/ # Mirror authoritative npm tarballs privately
└── release/         # Release Please
```

### setup

Setup pnpm, Node.js, and install dependencies.

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: astrale-os/config/.github/actions/setup@9bffee57d53b603b556bb545145fdde10f20a4c5
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
      - uses: astrale-os/config/.github/actions/ci@9bffee57d53b603b556bb545145fdde10f20a4c5
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
      - uses: astrale-os/config/.github/actions/publish/jsr@9bffee57d53b603b556bb545145fdde10f20a4c5
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
      - uses: astrale-os/config/.github/actions/publish/npm@9bffee57d53b603b556bb545145fdde10f20a4c5
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

### publish/mirror-npm-to-github

Mirror exact npm-published tarballs to private GitHub Packages copies after the authoritative npm
release has been independently qualified. The action does not build, pack from source, install, or
write to npm. Existing GitHub packages must already be private, linked to the named repository, and
grant that repository GitHub Actions access. GitHub omits the package `repository` field from a
repository-scoped `GITHUB_TOKEN` response, so linkage is an operator-provisioned precondition rather
than a claim made by the mirror run. The action continuously rejects any API-exposed mismatch and
proves the exact released manifest repository, private target, artifact bytes, and release tags.

Audit the provisioning with an owner token before enabling a mirror:

```bash
gh api orgs/astrale-os/packages/npm/sdk \
  --jq '{visibility, repository: .repository.full_name}'
```

```yaml
permissions:
  contents: read
  packages: write

steps:
  - uses: actions/checkout@v4
  - uses: astrale-os/config/.github/actions/publish/mirror-npm-to-github@9bffee57d53b603b556bb545145fdde10f20a4c5
    with:
      dirs: '. adapter-cloudflare adapter-astrale'
      github-token: ${{ github.token }}
      repository: astrale-os/sdk
```

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
      - uses: astrale-os/config/.github/actions/release@9bffee57d53b603b556bb545145fdde10f20a4c5
        with:
          token: ${{ github.token }}
          target-branch: main
```

| Input           | Default                         | Description                         |
| --------------- | ------------------------------- | ----------------------------------- |
| `token`         | required                        | GitHub token for releases and PRs   |
| `config-file`   | `.release-please-config.json`   | Path to config file                 |
| `manifest-file` | `.release-please-manifest.json` | Path to manifest file               |
| `target-branch` | repository default branch       | Branch Release Please should target |

**Outputs:** `releases_created`, `paths_released`, `prs_created`, `pr`, `prs`

The PR outputs are forwarded unchanged from Release Please so callers using the repository
`GITHUB_TOKEN` can explicitly qualify the generated PR revision. GitHub suppresses workflow events
created by that token, so relying on the PR's normal `pull_request` event is insufficient.
