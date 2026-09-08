# Shared agent setup sources

This directory owns the common runtime, browser and skill stages. The Domains repository is
the migrated consumer; these entry points are templates, not Config's own repository setup.

```bash
bash scripts/agent_setup/sync.sh ../domains
bash scripts/agent_setup/sync.sh --check ../domains
node --test scripts/agent_setup/sync.test.cjs
```

Synchronization copies only the explicit shared file list. It preserves `repo.config.sh`,
`setup_repo.sh`, Claude hooks, verification, tests and documentation. Review and commit both
Config and consumer changes. Startup never downloads shared setup code. Remove replaced
`setup_env_1.sh`, `setup_env_2.sh` and the old per-agent orchestrators/skill scripts when migrating
a consumer; sync does not delete arbitrary consumer files.

## Consumer contract

- `repo.config.sh` supplies `AGENT_SETUP_BROWSER` and `AGENT_SETUP_ASTRALE_CLI` defaults with
  `export NAME="${NAME:-0}"` (or `1`). Existing environment values take precedence. Only effective
  values `0` and `1` are accepted. This file contains choices, never versions or installation code.
- `.nvmrc` owns the exact Node 26 version; an existing `.node-version` must agree.
  `package.json#packageManager` owns the exact pnpm version, verified before installing each root.
- `setup.sh` loads/validates options and harnesses, calls `setup_repo.sh --check` before installation,
  then runs runtimes, optional browser tools, optional browser skills and repository work.
- `setup_repo.sh --check` must perform only the consumer's preflight checks. Direct repository
  setup enforces the same checks. The standalone helper preserves Git branch/HEAD, installs one
  root with `STANDALONE=true pnpm install --no-frozen-lockfile --prefer-offline` and reports changed
  lockfiles without committing. CI/release frozen policies remain separate.
- `AGENT_HARNESSES=codex`, `claude` or `codex,claude` selects skill destinations only. Missing/empty
  input detects installed harness commands; with neither present, no skills are installed.
  Codex uses `$HOME/.agents/skills`; Claude uses `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills`.
- Browser-off skips browser installers, skills and probes. Astrale-off skips the repository's
  published CLI, associated skills and checks. Existing installations are not deleted.
- Browser downloads and system libraries belong to `setup_browser_tools.sh`. CLI postinstall
  browser downloads are disabled. All three tools must launch the selected browser successfully
  and close their disposable sessions. Package-local Playwright tests retain their own versions.
- Setup Bun is independent of package-local locked Bun. Runtime preparation precedes JSON parsing.
  User-writable installation paths and shell profiles keep commands available in later shells.
- The Claude hook is consumer-owned: it locks installation and writes a per-checkout success marker
  only after setup and verification. Later calls only load paths. Codex Setup/Maintenance and direct
  calls always revalidate; they never consult Claude's marker.
- Workspace recursive submodule preflight and its three install roots belong to that consumer.
  Migrating Domains does not migrate the Workspace or the other consumer repositories.

## Repository defaults

These are the documented defaults for future consumer migrations, not a claim of installation.

| Repositories | Browser tools and skills | Published Astrale CLI and skills |
| --- | --- | --- |
| workspace, domains, shell, admin | 1 | 1 |
| gui, ui, prototype, cli | 1 | 0 |
| sdk, kernel, datastore, config | 0 | 0 |

Use the Domains regression suite and a fresh Linux setup when changing common behavior.
Also run syntax checks and the synchronization test here. New consumers must retain their own
native build policy and hooks, and update all callers before removing old entry points.
