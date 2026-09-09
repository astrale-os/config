# Develop Config with an agent

This directory prepares **the Config repository itself**. The distributed standard lives in
[`agent-setup/`](../../../agent-setup/README.md); its scripts are copied here by `sync.sh`.

From a standalone Config checkout (Node/pnpm are bootstrapped if needed):

```bash
AGENT_HARNESSES=codex bash scripts/setup/agent/setup.sh
AGENT_HARNESSES=codex bash scripts/setup/agent/verify.sh
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
  `AGENT_HARNESSES=codex bash scripts/setup/agent/setup.sh` in Setup script only.
- **Claude Cloud:** select `astrale-os/config` and leave Setup script empty. The committed
  `.claude/settings.json` runs setup and verification once per physical checkout, then restores
  paths on later sessions. After dependency/option changes, rerun setup explicitly.
  The hook needs network access: retain the default package-manager allowlist and allow Node
  downloads at `nodejs.org` plus the system package mirrors. If enabling browser or Astrale tools,
  use the [extended allowlist](https://github.com/astrale-os/domains/blob/main/scripts/setup/agent/README.md#cloud-and-conductor).
- **Conductor:** `.conductor/settings.toml` runs setup for Claude; Run verifies readiness.

## Maintain the two roles

Edit shared behavior in `agent-setup/`, then update Config's copies:

```bash
bash agent-setup/sync.sh .
pnpm check:agent-setup-sync
pnpm test:agent-setup
```

CI rejects drift between the standard and Config's copies. Synchronization preserves the
repository-owned files above, Claude's hook, the optional Astrale installer, tests and this README.
