# Domain contract workflows

These workflows publish each non-private Astrale Domain as a small Schema contract package. A
repository does not maintain a CI matrix, package directory input, install command, build command,
or publication order.

## Domain project contract

A publishable project has tracked `package.json` and `astrale.config.*` files. `private: true` is the
only opt-out. Release Please's `packages` map is the one deliberate release inventory; its paths and
managed manifest must exactly match discovery.

The Domain package itself owns a conventional `pnpm pack` journey. Its packed surface contains only
the Schema root export, `./package.json`, emitted files below `dist/schema`, and ordinary package
documents.

## CI caller

```yaml
jobs:
  domain-contracts:
    uses: astrale-os/config/.github/workflows/domain-contract-ci.yml@main
```

The called workflow checks out the caller, derives producer-first order, packs every public Domain
in a disposable project, inspects its complete tarball, and installs that tarball into a clean
consumer that imports the package root and package metadata. It does not use workspace links or
judge the caller's lockfile policy.

## Publication caller

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  domain-contracts:
    uses: astrale-os/config/.github/workflows/domain-contract-publish.yml@main
    permissions:
      contents: read
      id-token: write
```

On a release merge, the workflow selects only manifest versions changed from the preceding commit.
A manual dispatch selects every current public Domain and safely skips versions already present on
npm. Publication is producer-first and stops on an unknown registry read or failed package. Success
requires the immutable version, expected dist-tag, a fresh registry-only install, the root import,
the package-metadata import, and a clean TypeScript check of the published declarations. Runs for
the same repository ref are serialized so an older release cannot race a newer npm dist-tag.

Each npm package needs its Trusted Publisher configured once before its first release. The workflow
accepts no npm token and no Domain-specific credentials.

## Same-release Domain dependencies

Contract-to-contract dependencies remain normal semver dependencies. If a selected producer version
is not visible on npm yet, qualification uses that exact producer tarball only in the disposable
project. The authored manifest and packed consumer dependency remain unchanged. Cycles and ranges
that do not admit the selected producer version fail before publication.
