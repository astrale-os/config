#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_load_config
agent_resolve_harnesses
agent_check_repo
case "${1:-}" in
  --check) exit 0 ;;
  '') ;;
  *) agent_die 'Usage: setup_repo.sh [--check]' ;;
esac
agent_ensure_node
agent_ensure_bun
agent_install_repo
# Config ships configuration files and prebuilt JavaScript; no build is needed for setup.
if [[ "$AGENT_SETUP_ASTRALE_CLI" == 1 ]]; then
  if ! astrale --version >/dev/null 2>&1; then
    if "${ASTRALE_HOME:-$HOME/.astrale}/bin/astrale" --version >/dev/null 2>&1; then
      agent_link "${ASTRALE_HOME:-$HOME/.astrale}/bin/astrale" astrale
    else
      node "$SCRIPT_DIR/lib/install-astrale.cjs"
      agent_link "$AGENT_SETUP_HOME/astrale/bin/astrale" astrale
    fi
  else
    agent_link "$(command -v astrale)" astrale
  fi
  astrale --version
  for harness in ${AGENT_HARNESSES//,/ }; do
    for skill in astrale-cli astrale-domain; do
      agent_ensure_skill "$harness" astrale-os/cli "$skill"
    done
  done
else
  agent_log 'Astrale CLI and skills disabled by repository configuration'
fi
if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then agent_select_browser; fi
agent_persist_environment
agent_log 'Config dependencies and enabled tools are ready'
