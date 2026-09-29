# @astrale/config

Shared configurations and composite actions for Astrale TypeScript monorepos.

Shared environment preparation lives in [`setup/`](setup/README.md) and is distributed
as a pinned GitHub release archive. Config consumes it through
[`scripts/setup/`](scripts/setup/README.md), like other repositories.
Run `bash scripts/setup/setup.sh` to prepare this repository.

Repository-level GitHub merge policy is declared and reconciled from
[`github/repository-policy`](github/repository-policy/README.md).

## Packages

| Package                      | JSR                                                                                                   | Description                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| `@astrale-os/ox`             | —                                                                                                     | Shared oxlint and oxfmt configuration |
| `@astrale/typescript-config` | [![JSR](https://jsr.io/badges/@astrale/typescript-config)](https://jsr.io/@astrale/typescript-config) | Base tsconfig presets       |
| `@astrale/commitlint-config` | [![JSR](https://jsr.io/badges/@astrale/commitlint-config)](https://jsr.io/@astrale/commitlint-config) | Conventional commits config |
| `@astrale-os/renovate-config` | —                                                                                                     | Renovate dependency updates |

## Installation

Development defaults to **Node.js 26.7.0** and also supports Node.js 24. pnpm
**12.1.0** is required.

For repository development, run `STANDALONE=true pnpm install --frozen-lockfile` from the root of
a standalone clone. When working in the Astrale umbrella workspace, install from its root instead.

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
| `run-lint`             | `true`              | Run lint and format checks |
| `run-typecheck`        | `true`              | Run TypeScript checks     |
| `run-test`             | `true`              | Run tests                 |
| `run-build`            | `false`             | Run build                 |
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
        with:
          package: .
```

| Input               | Default  | Description                   |
| ------------------- | -------- | ----------------------------- |
| `node-version-file` | `.nvmrc` | Path to Node version file     |
| `allow-slow-types`  | `true`   | Allow slow types in JSR       |
| `package`           | required | Package directory to publish (relative to repo root) |

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
| `registry-url`      | `npm.pkg.github.com`         | npm registry URL                |
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
| `renderer` | none | Checked-out ES module that generates PR Markdown from structured release data |

**Outputs:** `releases_created`, `paths_released`, `prs_created`, `pr`, `prs`

The PR outputs retain Release Please's metadata so callers using the repository `GITHUB_TOKEN`
can explicitly qualify the generated PR revision. GitHub suppresses workflow events created by
that token, so relying on the PR's normal `pull_request` event is insufficient.

#### Custom release presentation

Set `renderer: .github/release/render.mjs` to generate the PR body before it is created or updated.
The module's default export receives `{ releases, repository, targetBranch, host, date }` and
returns Markdown, synchronously or asynchronously. It receives data, rather than an existing PR
body, and runs once for each candidate PR after all version and workspace dependency calculations.

```js
export default function render({ releases }) {
  const packages = releases.map(({ component, version, commits }) => {
    const summary = component ? `${component}: ${version}` : version
    const changes = commits.map(({ bareMessage }) => `* ${bareMessage}`).join('\n')
    return `<details><summary>${summary}</summary>\n\n## ${version}\n\n${changes}\n</details>`
  })
  return ['Release preview', '---', ...packages, '---', 'Generated release'].join('\n\n')
}
```

Each release includes:

- `path`, `component`, `name` (for Node packages), and `version`;
- `previousVersion`, `previousTag`, and `currentTag` for comparisons;
- `commits`: the parsed Conventional Commits passed to the release strategy, including `type`,
  `scope`, `bareMessage`, `sha`, breaking-change notes, references, and PR metadata;
- `changelogSections`: the configured section names and visibility;
- `dependencies`: `{ type, name, from, to }` changes derived from the actual package updates and
  released workspace versions. All dependency kinds are supplied; the renderer chooses which to
  show. Unchanged peer ranges and external dependencies are omitted.

`repository` is `owner/repo`, `host` is the GitHub server URL, and `date` is the UTC date in
`YYYY-MM-DD` format. The module path is relative to the trusted target-branch checkout; loading it
requires no consumer dependency installation.

Release Please reads the generated body again when publishing. Emit its `---` delimiters and
package/version markers (`<details><summary>component: version</summary>`, or a version heading for
a componentless release). The adapter uses Release Please's own parser to verify the complete
component/version inventory and serialize the native envelope before any PR write. This keeps
subsequent unchanged invocations comparable. Place custom Markdown inside the header, footer, or
each release's notes; the adapter retains the native body structure. Rendering all candidate PRs must succeed first;
a failed import, render, or identity check leaves their bodies untouched. The normal Release Please
comparison skips unchanged PRs without a separate read/patch cycle.

With a renderer, the action runs the pinned Release Please **17.6.0** library (matching the default
action) through its own Node.js runner. It installs only the action's private runtime with `npm ci`
from the checked-in lockfile, with lifecycle scripts disabled; repository dependencies are not
installed. Release creation, versioning, manifest/changelog updates, and PR writes stay owned by
Release Please. The renderer controls the PR Markdown and the subsequent GitHub release notes;
repository changelogs retain the configured native generator. Without `renderer`, the existing
upstream action is used unchanged.
