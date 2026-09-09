# Shared agent setup sources

This directory owns the common runtime, browser and skill stages. Consumer repositories use committed copies. The unified layout is published for Config,
SDK, Domains, Shell, Admin, CLI, Datastore, GUI, UI and Prototype. Kernel and Workspace
are excluded from this rollout and retain their existing pinned standards. Config's own setup lives in
[`scripts/setup`](../scripts/setup/README.md); this directory is the distributed standard.

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
   `package.json#packageManager`. Create `scripts/setup/repo.config.sh` with the two
   defaults below, choosing `0` or `1` for each. Keep this file limited to options:

   ```bash
   export AGENT_SETUP_BROWSER="${AGENT_SETUP_BROWSER:-0}"
   export AGENT_SETUP_ASTRALE_CLI="${AGENT_SETUP_ASTRALE_CLI:-0}"
   ```

3. Create `scripts/setup/setup_repo.sh` for **all repository-specific preparation**:
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
   Follow [Domains' cloud configuration](https://github.com/astrale-os/domains/blob/main/scripts/setup/README.md#cloud-and-conductor),
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
  only after setup and verification. Later calls only load paths. Codex Setup (caching disabled, no Maintenance script) and direct
  calls always revalidate; they never consult Claude's marker.
- Workspace recursive submodule preflight and its three install roots belong to that consumer.
  Migrating Domains does not migrate the Workspace or the other consumer repositories.

## Repository defaults

The previous agent-setup migration covers Config, Domains, Shell, Admin, CLI, SDK,
Datastore, GUI, UI and Prototype. Workspace setup is published, with full installation
and real-cloud validation pending. Kernel has a separate migration in progress.
The unified layout and tool policy were piloted on Config and SDK; the remaining
standalone consumers listed above are migrated. Kernel and Workspace are
explicitly excluded. See [rollout validation](VALIDATION.md) for checks and limits.

| Repositories | Browser tools and skills | Published Astrale CLI and skills |
| --- | --- | --- |
| workspace, domains, shell, admin | 1 | 1 |
| gui, ui, prototype | 1 | 0 |
| cli, sdk, kernel, datastore, config | 0 | 0 |

Use the Domains regression suite and a fresh Linux setup when changing common behavior.
Also run syntax checks and the synchronization test here. New consumers must retain their own
native build policy and hooks, and update all callers before removing old entry points.

## One setup, two tool policies

Consumer entry point: `scripts/setup/setup.sh`. Shared sources remain here under
`agent-setup/`; synchronize only reviewed consumers, update their callers and cloud
environment commands at publication, and remove their old `scripts/setup/agent/`
entry points. Existing consumers pinned to earlier commits are not migrated implicitly.

- `AGENT_SETUP_TOOLS=install` is the default: reuse working tools, install/repair
  missing tools, publish managed paths and selected skills as before.
- `AGENT_SETUP_TOOLS=check` is selected by Conductor: inspect caller PATH, fail
  clearly for missing tools or mismatched pinned versions, never install global
  tools or modify user profiles/symlinks/skills. Harness selection is ignored in
  this mode because personal skills are user-managed. Browser tools, when required,
  must already launch successfully. No browser download or library repair is allowed.

Both modes execute the same checkout preparation. They are not offline modes;
package dependencies and necessary project artifacts still need preparation.
Repository-specific installers must honor the tool policy as well. A tool policy
is not a sandbox for package lifecycle scripts: checked-in build policies still apply.

`setup_repo.sh --check` remains a separate read-only Git/manifest preflight; it
does not mean the same thing as `AGENT_SETUP_TOOLS=check`. Only Workspace owns
explicit latest-main refresh; standalone repositories always preserve their branch.

## Claude prepared-checkout invalidation

Consumer hooks keep a lock per physical checkout, but the success marker contains
`agent_setup_fingerprint`, not a permanent `ready` flag. It hashes the effective
browser/CLI flags and current (including dirty) setup scripts, package manifests,
pnpm workspace/lock/config files, runtime pins, Bun lockfiles, patches and Claude
settings. Ordinary source edits and branch names alone do not trigger installation.
Legacy markers and missing shell environments trigger preparation again. A failed
refresh removes the previous success marker; setup plus verification must succeed
before publishing a new one. Fingerprints are computed under the checkout lock,
and after successful preparation so legitimate lockfile updates remain reusable.
Codex and local Conductor behavior are unchanged. Kernel and Workspace remain
outside this rollout.
