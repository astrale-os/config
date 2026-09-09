# Astrale environment setup

This package owns environment preparation. Consumers pin its exact published
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
It downloads from npm, validates the checked-in digest before extraction, and
shares only the verified archive cache. It never follows latest or a Git branch.
Archive fetch is separate from machine-tool installation; local `check` mode can
fetch this pinned package while refusing installation of global runtimes/browsers.

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
