# Astrale environment setup

This directory owns environment preparation. Consumers pin its exact published
archive version and SHA-256 in `scripts/setup/setup.lock`, retain the stable
`bootstrap/setup.sh` launcher and declare their profile in `repo.sh`:

```bash
export AGENT_SETUP_PROFILE=sdk
export AGENT_SETUP_BROWSER=0
export AGENT_SETUP_ASTRALE_CLI=0
```

Initial pilots: SDK and GUI. GUI enables browsers and retains its own package
scripts; its Electron preparation lives here. Other profiles are not admitted yet.
Legacy `agent-setup/` and its consumers remain supported during migration.

## Entry points

- `bash scripts/setup/setup.sh`: tools, dependencies, artifacts, verification.
- `bash scripts/setup/setup.sh verify`: read-only readiness, no package fetch.
- `bash scripts/setup/setup.sh artifacts`: only product preparation; no root install.
- Claude SessionStart: `bash "$CLAUDE_PROJECT_DIR/scripts/setup/setup.sh" claude`.
- Conductor: `AGENT_SETUP_TOOLS=check bash scripts/setup/setup.sh`.

Codex keeps cache disabled and Maintenance empty. Claude keeps environment Setup
empty. The remote hook owns locking and input-based reuse, and writes a success
marker only after all checks pass. Local hooks load prepared paths only.

The bootstrap requires Bash, curl, tar/gzip and sha256sum or shasum, not Node/npm.
It downloads from a public Config GitHub release, validates the checked-in digest before extraction, and
shares only the verified archive cache. It never follows latest or a Git branch.
Archive fetch is separate from machine-tool installation; local `check` mode can
fetch this pinned archive while refusing installation of global runtimes/browsers.

## Ownership and composition

Package implementations receive the repository path explicitly. Runtime pins
remain in `.nvmrc`, `.bun-version` and package manifests. Runtime downloads may
be shared, while activation links and environment files are per checkout.
`profiles/` compose repository-specific prerequisites, preparation and checks.
Build commands and tests stay owned by the product; profiles call them.

Workspace adoption will explicitly compose shared tools, its three dependency
roots, then artifact steps. It must not invoke standalone root installation for
each product. Its latest-main policy must preserve dirty/local work.

## Rollout gates

Before publishing: test the packed archive, bootstrap integrity/cache behavior,
external repository paths, local check mode and automatic Claude reuse. Validate
SDK and GUI on fresh Linux and real clouds before replacing legacy consumers.
Expand profiles and remove the legacy synchronizer only after all consumers pass.

## Distribution

No new npm package is published. The private package manifest is only used by
Config's workspace tests and records the archive version.

Run `bash packages/agent-setup/pack.sh /tmp/setup-release` to produce
`astrale-setup-VERSION.tar.gz` and its SHA256 file. The archive has a `package/`
root and includes only the runtime, profiles, bootstrap, README and manifest.

The **Publish setup archive** workflow must be dispatched on main after checks
pass. It tests and packs the checked-out revision, then creates a prerelease
`setup-vVERSION` with both files; it never replaces an existing tag or asset.
Increment the private manifest version before the next release. Promote the
prerelease only after SDK and GUI automatic cloud validation succeeds.

Consumers commit `VERSION SHA256` in `setup.lock`; the bootstrap downloads
`https://github.com/astrale-os/config/releases/download/setup-vVERSION/astrale-setup-VERSION.tar.gz`.
It never resolves latest. Keep GitHub and its release asset redirect host
`release-assets.githubusercontent.com` accessible in cloud environments.
A public asset was verified from Claude SDK without Config attached. Automatic
bootstrap validation for the SDK and GUI pilots is complete; details follow below.

The isolated Chrome DevTools readiness probe uses `--no-sandbox` for root cloud
VMs and GitHub Actions runners, where downloaded Chromium cannot create its
sandbox. The probe opens only `about:blank`; ordinary local users retain the
browser sandbox. No machine security setting is changed.

GUI readiness executes Electron with `--version`, without starting the application
or requiring a display, and compares it with the installed package version. An
executable file alone is not sufficient. During installation only, a diagnosed
missing `libgtk-3.so.0` is repaired through the same bounded, signed APT path as
Chromium. Read-only verification and local check mode never install that library.
Application UI smoke tests still require a display (or Xvfb) and the product's
own build/start commands; this readiness check does not replace them.

The Electron version probe follows the same root/GitHub Actions sandbox policy
as the isolated Chrome DevTools probe; local users keep the normal sandbox.

## Pilot validation (2026-09-10)

SDK and GUI archive consumers are merged on their respective main branches.
SDK pins `setup-v0.1.0`; GUI pins `setup-v0.1.3`, which has been promoted from
prerelease. Published archives and their digests remain immutable.

- SDK: fresh Linux installation and automatic Codex/Claude preparation passed,
  including readiness, lint and typecheck without manually rerunning setup.
  Product tests still have four failures in Codex and five in Claude; their cause
  is not established. GitHub CI passed. See the
  [SDK validation report](https://github.com/astrale-os/sdk/blob/main/scripts/setup/README.md#pilot-validation-2026-09-10).
- GUI: fresh Linux installation verified GTK repair. Both clouds automatically
  verified archive 0.1.2, Electron and all three browsers; earlier cloud product
  runs passed all 144 tests plus lint and typecheck. Claude also verified automatic
  preparation after a changed archive pin. Archive 0.1.3 adds the GitHub runner
  condition to the Electron probe and passed actual archive installation and
  Electron verification in GitHub CI. Application display/end-to-end tests remain
  separate. See the
  [GUI validation report](https://github.com/astrale-os/gui/blob/main/scripts/setup/README.md#validation-2026-09-10).

Other repository profiles and Workspace composition still require migration and
qualification before the legacy synchronizer can be removed.
