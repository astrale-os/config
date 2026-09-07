#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

export AGENT_SETUP_AGENT=codex
bash "$SCRIPT_DIR/setup_env_1.sh"
bash "$SCRIPT_DIR/setup_env_2.sh"
bash "$SCRIPT_DIR/setup_codex_skills.sh"
bash "$SCRIPT_DIR/setup_repo.sh"
agent_log 'Codex setup complete'
