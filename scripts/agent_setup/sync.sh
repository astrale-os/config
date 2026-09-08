#!/usr/bin/env bash
# Explicit maintainer action. Consumer configuration and integrations stay repository-owned.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

mode=copy
if [[ "${1:-}" == --check ]]; then mode=check; shift; fi
[[ "$#" -gt 0 ]] || agent_die 'Usage: bash scripts/agent_setup/sync.sh [--check] /path/to/repo [...]'
files=(lib/common.sh lib/browser-check.cjs lib/skill-check.cjs setup.sh setup_runtimes.sh
  setup_browser_tools.sh setup_skills.sh)
for repository in "$@"; do
  [[ -f "$repository/package.json" ]] || agent_die "Not a repository root: $repository"
  target="$(cd "$repository" && pwd)/scripts/agent_setup"
  [[ "$target" != "$SCRIPT_DIR" ]] || agent_die 'Cannot sync config onto itself'
  for file in "${files[@]}"; do
    if [[ "$mode" == check ]]; then
      cmp -s "$SCRIPT_DIR/$file" "$target/$file" || agent_die "Out of sync: $target/$file"
    else
      mkdir -p "$(dirname "$target/$file")"
      cp "$SCRIPT_DIR/$file" "$target/$file"
    fi
  done
  agent_log "$mode: $target (repo.config.sh and setup_repo.sh preserved)"
done
