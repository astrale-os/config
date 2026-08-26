# Domains workflows

These workflows publish each non-private Astrale Domain package. A
repository does not maintain a CI matrix, package directory input, install command, build command,
or publication order.

## Domain project requirements

A publishable project has tracked `package.json` and `astrale.config.*` files. `private: true` is the
only opt-out. Release Please's `packages` map is the one deliberate release inventory; its paths and
managed manifest must exactly match discovery.

The Domain package itself owns a conventional `pnpm pack` journey and decides its public API,
layout, exports, compiler, and artifact contents. Config verifies the packed name and version, then
proves that a clean consumer can install and import the package root. It does not inspect Schema
folders, require SDK exports, or duplicate the package command's semantic checks.

## CI caller

```yaml
jobs:
  domains:
    uses: astrale-os/config/.github/workflows/domains-ci.yml@9bffee57d53b603b556bb545145fdde10f20a4c5
```

The called workflow checks out the caller, derives producer-first order, packs every public Domain
in a disposable project, verifies each tarball identity, and resolves that tarball in a clean
consumer with dependency lifecycle scripts disabled before importing the package root. It does not
use workspace links or judge the caller's lockfile, SDK, compiler, declarations, lifecycle policy,
or export policy.

## Publication caller

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  domains:
    uses: astrale-os/config/.github/workflows/domains-publish.yml@9bffee57d53b603b556bb545145fdde10f20a4c5
    permissions:
      contents: read
      id-token: write
```

On a release merge, the workflow selects only manifest versions changed from the preceding commit.
A manual dispatch selects every current public Domain and safely skips versions already present on
npm. Publication is producer-first and stops on an unknown registry read or failed package. Success
requires the immutable version, expected dist-tag, a fresh registry-only resolution with dependency
lifecycle scripts disabled, and the root import. Repository publication runs queue sequentially so
no version-changing release is dropped and an older run cannot race a newer npm dist-tag.

Each npm package needs its Trusted Publisher configured once before its first release. The workflow
accepts no npm token and no Domain-specific credentials.

## Same-release Domain dependencies

Domain-to-Domain dependencies remain normal semver dependencies. If a selected producer version
is not visible on npm yet, qualification uses that exact producer tarball only in the disposable
project. The authored manifest and packed consumer dependency remain unchanged. Cycles and ranges
that do not admit the selected producer version fail before publication.
