# Shared agent setup sources

This directory owns the common Node/Bun/browser/skills setup used by Astrale repositories.
The first consumer is `astrale-os/domains`; each consumer supplies its own `setup_repo.sh`.
These entry points are templates for consumers, not Config's own repository setup.

```bash
bash scripts/agent_setup/sync.sh ../domains
bash scripts/agent_setup/sync.sh --check ../domains
```

The explicit file list in `sync.sh` copies only shared sources. It never replaces repository
setup, Claude hooks, Conductor configuration, verification, tests or documentation. Review and
commit both the Config source and consumer copies. Nothing downloads shared scripts at startup.

Consumer contracts:

- `.nvmrc` declares one exact Node 26 version. If present, `.node-version` must agree.
- `package.json#packageManager` declares an exact pnpm version; each installed root verifies it.
- `setup_repo.sh` sources `lib/common.sh` and performs its own repository work. The standalone
  `agent_install_repo` helper installs only that root, with `STANDALONE=true`, a frozen lockfile
  and `--prefer-offline`. It never switches branches or changes Git revisions.
- The two orchestrators set `AGENT_SETUP_AGENT` (`codex` or `claude-code`) and execute env_1,
  env_2, agent skills, then repository setup. Workspace submodule synchronization and its three
  install roots belong in the Workspace consumer's repository script, not in these shared files.
- env_1 owns all browser downloads and system dependencies. env_2 installs only CLI tools and
  checks that they work with the explicit Playwright Chromium path. Each check closes only its
  own browser sessions. Browser incompatibility fails setup.
- Reuse functional installations, but verify actual commands, exact Node/pnpm versions and live
  browser launches on every run. No completion markers, snapshots, maintenance orchestrators,
  tool version manifests or runtime downloads of setup scripts.

Dependencies use published npm releases; skills use their current upstream repositories.
Playwright, agent-browser, Chrome DevTools and skills are not pinned here. Node is prepared from
`.nvmrc` before any JSON parsing. Setup Bun is independent from packages' locked local Bun.

Use the regression and live setup checks in the Domains consumer when changing shared behavior.
For any new consumer, migrate its existing native build policy, hooks, CLI and skills into its
repository step and update callers before removing replaced setup files.
