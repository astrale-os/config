#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_ensure_node
agent_select_browser
agent_ensure_cli agent-browser agent-browser
agent_ensure_cli chrome-devtools chrome-devtools-mcp
if ! agent_check_browser agent-browser; then
  agent_npm_install "$AGENT_TOOLS" agent-browser@latest
  agent_link "$AGENT_TOOLS/bin/agent-browser" agent-browser
  agent_check_browser agent-browser
fi
if ! agent_check_browser chrome-devtools; then
  agent_npm_install "$AGENT_TOOLS" chrome-devtools-mcp@latest
  agent_link "$AGENT_TOOLS/bin/chrome-devtools" chrome-devtools
  agent_check_browser chrome-devtools
fi
agent_persist_environment
