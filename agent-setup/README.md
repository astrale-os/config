# Shared agent setup sources

This directory owns the common runtime, browser and skill stages. Config, Domains, Shell, Admin, CLI, SDK, Kernel and Datastore consume
committed copies. Config's own setup lives in
[`scripts/setup/agent`](../scripts/setup/agent/README.md); this directory is the distributed standard.

The shared browser stage includes Domains' cloud fixes: reuse healthy Playwright/Chromium
caches, repair system libraries only when a launch reports them missing, and use temporary
signed official sources for Ubuntu 24.04 images configured with snapshot archives.

```bash
bash agent-setup/sync.sh . ../domains
bash agent-setup/sync.sh --check . ../domains
node --test agent-setup/*.test.cjs
```

Synchronization copies only the explicit shared file list. It preserves `repo.config.sh`,
`setup_repo.sh`, Claude hooks, verification, tests and documentation. Review and commit both
Config and consumer changes. CI checks Config's copies with `pnpm check:agent-setup-sync`.
Startup never downloads shared setup code. Remove replaced
`setup_env_1.sh`, `setup_env_2.sh` and the old per-agent orchestrators/skill scripts when migrating
a consumer; sync does not delete arbitrary consumer files.

## Adopt in a new repository

This standard currently targets standalone Git checkouts using Node 26 and pnpm. For another
runtime or package manager, extend the shared contract in Config before adopting it.

1. Run `bash agent-setup/sync.sh /path/to/repo` from Config. Reuse the
   copied orchestrator, runtime/browser/skill stages and shared helpers unchanged. Make shared
   fixes in Config, then synchronize; consumer edits to synchronized files will be overwritten.
2. Set the repository's exact Node version in `.nvmrc` and pnpm version in
   `package.json#packageManager`. Create `scripts/setup/agent/repo.config.sh` with the two
   defaults below, choosing `0` or `1` for each. Keep this file limited to options:

   ```bash
   export AGENT_SETUP_BROWSER="${AGENT_SETUP_BROWSER:-0}"
   export AGENT_SETUP_ASTRALE_CLI="${AGENT_SETUP_ASTRALE_CLI:-0}"
   ```

3. Create `scripts/setup/agent/setup_repo.sh` for **all repository-specific preparation**:
   extra prerequisites, generated files, required local builds and additional tool setup.
   This minimal starting point installs one pnpm workspace and supports direct execution:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   source "$SCRIPT_DIR/lib/common.sh"
   agent_load_config
   agent_resolve_harnesses
   agent_check_repo
   # Add read-only repository prerequisite checks here, without requiring installed runtimes.
   case "${1:-}" in
     --check) exit 0 ;;
     '') ;;
     *) agent_die 'Usage: setup_repo.sh [--check]' ;;
   esac
   agent_ensure_node
   agent_ensure_bun
   agent_install_repo
   # Add repeatable repository preparation here; agent_install_repo leaves cwd at repo root.
   if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then agent_select_browser; fi
   agent_persist_environment
   ```

   `--check` must install/write nothing: the orchestrator calls it before the runtime stage.
   Keep preparation safe to rerun and preserve existing Git work and native-build policy.
   **Astrale-on needs implementation:** synchronization does not supply the CLI installer.
   If enabling it, adapt Domains' guarded Astrale block in `setup_repo.sh` and its
   `lib/install-astrale.cjs`, including both Astrale skills; otherwise keep the option at `0`.
4. Create `verify.sh` to check readiness without installing anything. Adapt Domains' example:
   replace its `issues`-specific Bun check with checks for your packages, and honor the same
   options and selected agents. Add tests for your prerequisites and custom preparation.
5. Wire the entry points into the repository's package scripts and agent configuration.
   For Claude Cloud, adapt Domains' `claude_session_start.sh` and `.claude/settings.json`;
   for Conductor, adapt `.conductor/settings.toml`. Preserve existing hooks/settings.
   Follow [Domains' cloud configuration](https://github.com/astrale-os/domains/blob/main/scripts/setup/agent/README.md#cloud-and-conductor),
   replacing the repository name and extending allowed domains for custom downloads.
6. Check `sync.sh --check /path/to/repo`, run setup and verification in a fresh environment,
   and rerun to check reuse and Git preservation. Document custom requirements in the consumer's
   README and commit its scripts. Ordinary agent working instructions belong in its
   `AGENTS.md`/`CLAUDE.md`; executable setup logic belongs in `setup_repo.sh`.

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

Config, Domains, Shell, Admin, CLI, SDK, Kernel and Datastore implement these defaults. GUI, UI, Prototype and Workspace remain migration targets.

| Repositories | Browser tools and skills | Published Astrale CLI and skills |
| --- | --- | --- |
| workspace, domains, shell, admin | 1 | 1 |
| gui, ui, prototype | 1 | 0 |
| cli, sdk, kernel, datastore, config | 0 | 0 |

Use the Domains regression suite and a fresh Linux setup when changing common behavior.
Also run syntax checks and the synchronization test here. New consumers must retain their own
native build policy and hooks, and update all callers before removing old entry points.
