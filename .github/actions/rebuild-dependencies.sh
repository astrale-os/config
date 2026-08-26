#!/usr/bin/env bash
set -euo pipefail

export STANDALONE=true
export NPM_CONFIG_OFFLINE=true
export npm_config_offline=true

action_root="$(cd "$(dirname "$0")" && pwd)"
bash "$action_root/run-token-free.sh" pnpm -r rebuild --pending
