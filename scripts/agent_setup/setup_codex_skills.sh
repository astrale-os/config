#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

agent_ensure_node
agent_ensure_skill codex vercel-labs/agent-browser agent-browser
agent_ensure_skill codex ChromeDevTools/chrome-devtools-mcp chrome-devtools-cli
