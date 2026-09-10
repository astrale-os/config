# Prepare Config

This directory consumes the shared [setup archive](../../setup/README.md).
`setup.lock` pins its version and SHA-256; `repo.sh` selects the Config profile.
Implementation lives in `setup/`; this directory contains only consumer entry points.

Setup prepares Node, pnpm, Bun and repository dependencies, then checks TypeScript,
oxlint, oxfmt and local ox exports. It installs neither browsers nor the Astrale CLI,
and does not build or publish products. Dependency installation may update the
lockfile; inspect changes before committing.

- Prepare: `bash scripts/setup/setup.sh`.
- Verify without installation/download: `bash scripts/setup/verify.sh`.
- Codex: disable cache; Setup `AGENT_HARNESSES=codex bash scripts/setup/setup.sh`;
  Maintenance empty.
- Claude: environment Setup empty; committed SessionStart runs preparation when
  input fingerprints change, otherwise restores paths. Failed setup is never cached.
- Conductor: `AGENT_SETUP_TOOLS=check bash scripts/setup/setup.sh` requires existing
  machine tools and prepares dependencies. Local Claude hooks only restore paths.

Run installation from the standalone repository root. In the umbrella workspace,
use its root installation instead. Network requirements and the archive update
procedure are documented in the shared setup README.
