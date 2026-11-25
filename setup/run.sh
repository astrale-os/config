#!/usr/bin/env bash
set -euo pipefail
export AGENT_REPO_ROOT="${1:?Usage: run.sh REPOSITORY [prepare|verify|artifacts|codex|claude]}"
action="${2:-prepare}"
if [[ "$action" == codex ]]; then export AGENT_HARNESSES=codex; fi
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PACKAGE_DIR/lib/common.sh"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-$AGENT_SETUP_HOME/logs/wrangler}"
agent_load_config
agent_resolve_harnesses
case "${AGENT_SETUP_PROFILE:-}" in config|sdk|gui|cli|admin|domains|shell|datastore|ui|prototype|kernel|mcp|workspace) ;; *) agent_die 'Unsupported setup profile';; esac
repo_checkout() { :; }
repo_dependencies() { agent_install_repo; }
source "$PACKAGE_DIR/profiles/$AGENT_SETUP_PROFILE.sh"
source "$PACKAGE_DIR/lib/verify.sh"
source "$PACKAGE_DIR/lib/astrale.sh"
agent_prepare() {
  repo_preflight
  repo_checkout
  bash "$PACKAGE_DIR/setup_runtimes.sh"
  if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then
    export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"
  fi
  bash "$PACKAGE_DIR/setup_browser_tools.sh"
  agent_prepare_astrale
  bash "$PACKAGE_DIR/setup_skills.sh"
  # Child preparation publishes activation links; this shell already has them on PATH.
  repo_dependencies
  repo_prepare
  if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then agent_select_browser; fi
  agent_persist_environment
  agent_verify
}
cd "$AGENT_REPO_ROOT"
case "$action" in
  prepare|codex) agent_prepare ;;
  verify) agent_verify ;;
  artifacts) repo_preflight; repo_prepare ;;
  claude) source "$PACKAGE_DIR/lib/claude.sh"; agent_claude ;;
  *) agent_die "Unknown action: $action" ;;
esac
