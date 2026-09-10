#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_load_config
agent_resolve_harnesses
if [[ -z "$AGENT_HARNESSES" ]]; then
  agent_log 'No harness selected; skipping browser skills'
  exit 0
fi
agent_ensure_node
for harness in ${AGENT_HARNESSES//,/ }; do
  if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then
    agent_ensure_skill "$harness" vercel-labs/agent-browser agent-browser
    agent_ensure_skill "$harness" ChromeDevTools/chrome-devtools-mcp chrome-devtools-cli
  fi
  if [[ "$AGENT_SETUP_ASTRALE_CLI" == 1 ]]; then
    agent_ensure_skill "$harness" astrale-os/cli astrale-cli
    agent_ensure_skill "$harness" astrale-os/cli astrale-domain
  fi
done
