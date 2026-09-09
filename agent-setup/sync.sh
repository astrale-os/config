#!/usr/bin/env bash
# Explicit maintainer action. Consumer configuration and integrations stay repository-owned.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sync_log() { printf '[agent-setup] %s\n' "$*"; }
sync_die() { printf '[agent-setup] ERROR: %s\n' "$*" >&2; exit 1; }

mode=copy
if [[ "${1:-}" == --check ]]; then mode=check; shift; fi
[[ "$#" -gt 0 ]] || sync_die 'Usage: bash agent-setup/sync.sh [--check] /path/to/repo [...]'
files=(lib/common.sh lib/browser.sh lib/browser-check.cjs lib/skill-check.cjs setup.sh setup_runtimes.sh
  setup_browser_tools.sh setup_skills.sh)
for repository in "$@"; do
  [[ -f "$repository/package.json" ]] || sync_die "Not a repository root: $repository"
  target="$(cd "$repository" && pwd)/scripts/setup"
  [[ "$target" != "$SCRIPT_DIR" ]] || sync_die 'Cannot overwrite shared sources'
  for file in "${files[@]}"; do
    if [[ "$mode" == check ]]; then
      cmp -s "$SCRIPT_DIR/$file" "$target/$file" || sync_die "Out of sync: $target/$file"
    else
      mkdir -p "$(dirname "$target/$file")"
      cp "$SCRIPT_DIR/$file" "$target/$file"
    fi
  done
  sync_log "$mode: $target (repo.config.sh and setup_repo.sh preserved)"
done
