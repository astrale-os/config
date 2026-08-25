#!/usr/bin/env bash
set -euo pipefail

# This script must only be called from the action step that follows the
# authenticated, script-free install. Its process tree must never inherit the
# registry token used by that prior step.
unset NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN
unset ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
unset ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN ASTRALE_AUTONOMOUS_INSTALL_TOKEN

export STANDALONE=true

umask 077
rebuild_userconfig="$(mktemp)"
trap 'rm -f "$rebuild_userconfig"' EXIT
{
  printf '%s\n' 'registry=https://registry.npmjs.org'
  printf '%s\n' '@astrale-os:registry=https://registry.npmjs.org'
  printf '%s\n' '@astrale-domains:registry=https://registry.npmjs.org'
  printf '%s\n' '@astrale:registry=https://registry.npmjs.org'
} > "$rebuild_userconfig"
export NPM_CONFIG_USERCONFIG="$rebuild_userconfig"

pnpm -r rebuild --pending
