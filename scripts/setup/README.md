# Develop Config with an agent

This directory prepares **the Config repository itself**. The distributed standard lives in
[`agent-setup/`](../../agent-setup/README.md); its scripts are copied here by `sync.sh`.

From a standalone Config checkout (Node/pnpm are bootstrapped if needed):

```bash
AGENT_HARNESSES=codex bash scripts/setup/setup.sh
AGENT_HARNESSES=codex bash scripts/setup/verify.sh
```

Use `claude` or `codex,claude` for other skill destinations. Setup prepares Node, pnpm, Bun
and Config's workspace dependencies; it may update the lockfile and reports changes.
Verification checks exact Node/pnpm versions, TypeScript, oxlint, oxfmt and the local ox exports.
Setup does not build or publish packages.

Browser tools and Astrale CLI/skills are **disabled by default**. To enable either, set
`AGENT_SETUP_BROWSER=1` or `AGENT_SETUP_ASTRALE_CLI=1` for both setup and verification.
`repo.config.sh` owns those defaults; `setup_repo.sh` owns Config-specific preparation;
`verify.sh` owns readiness checks. Ordinary working instructions belong in `AGENTS.md`.

## Cloud and Conductor

- **Codex Cloud:** select `astrale-os/config`, disable container caching, and put
  `AGENT_HARNESSES=codex bash scripts/setup/setup.sh` in Setup script only.
- **Claude Cloud:** select `astrale-os/config` and leave Setup script empty. The committed
  `.claude/settings.json` runs setup and verification once per checkout and input fingerprint,
  then restores paths on later sessions. Changes to setup scripts, dependency manifests,
  runtime pins or setup options automatically trigger preparation at the next SessionStart.
  The success marker is written only after setup and verification pass.
  The hook needs network access: retain the default package-manager allowlist and allow Node
  downloads at `nodejs.org` plus the system package mirrors. If enabling browser or Astrale tools,
  use the [extended allowlist](https://github.com/astrale-os/domains/blob/main/scripts/setup/README.md#cloud-and-conductor).
- **Conductor:** `.conductor/settings.toml` selects tool-check mode; Run verifies readiness.

## Maintain the two roles

Edit shared behavior in `agent-setup/`, then update Config's copies:

```bash
bash agent-setup/sync.sh .
pnpm check:agent-setup-sync
pnpm test:agent-setup
```

CI rejects drift between the standard and Config's copies. Synchronization preserves the
repository-owned files above, Claude's hook, the optional Astrale installer, tests and this README.

## Local / Conductor

One entry point serves both environments. `AGENT_SETUP_TOOLS=install` (default)
reuses working global tools and installs or repairs missing ones.
`AGENT_SETUP_TOOLS=check` checks the tools exposed on the caller’s PATH without
installing tools, changing global symlinks, writing shell profiles, or managing
personal skills. It fails with an actionable message for a missing/wrong tool.
Conductor selects `check`; cloud configuration selects `install` (or its default).

Both modes prepare repository dependencies and required artifacts using the same
repository script. This is not an offline mode: dependency installation still
uses the network and the package manager’s caches/build policy. Existing
`node_modules` alone is not accepted as proof of readiness. Neither mode changes
the standalone repository’s branch or commits its lockfile changes.

```bash
AGENT_SETUP_TOOLS=check bash scripts/setup/setup.sh
AGENT_SETUP_TOOLS=check bash scripts/setup/verify.sh
```

The committed Conductor setup runs once when preparing a new worktree; its Run
command verifies readiness. Local Claude SessionStart keeps loading previously
prepared paths only; it does not install dependencies at every session.
