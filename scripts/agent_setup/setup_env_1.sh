#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_bootstrap_system
agent_ensure_node
agent_ensure_bun
agent_ensure_cli playwright playwright
if ! agent_playwright_module >/dev/null 2>&1; then
  agent_npm_install "$AGENT_TOOLS" playwright@latest
  agent_link "$AGENT_TOOLS/bin/playwright" playwright
fi
agent_select_browser
if [[ ! -x "$AGENT_BROWSER_EXECUTABLE_PATH" ]]; then
  agent_log 'Installing the Chromium revision required by Playwright'
  playwright install --force --no-shell chromium
fi
if ! agent_check_browser playwright; then
  if [[ "$(uname -s)" == Linux ]]; then
    if [[ "$(id -u)" != 0 ]] && { ! command -v sudo >/dev/null 2>&1 || ! sudo -n true; }; then
      agent_die 'Installing Chromium system libraries requires root or passwordless sudo'
    fi
    # Playwright selects the appropriate distro libraries. Only repair when launch fails.
    playwright install-deps chromium
  fi
  if ! agent_check_browser playwright; then
    # Repair a corrupt download even when Playwright's own install marker still exists.
    # --no-shell avoids a second headless-only Chromium download: all tools share this binary.
    playwright install --force --no-shell chromium
  fi
  agent_select_browser
  agent_check_browser playwright
fi
agent_persist_environment
