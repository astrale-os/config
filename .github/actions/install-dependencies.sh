#!/usr/bin/env bash
set -euo pipefail

install_args=(install)
if [[ "${INSTALL_FROZEN_LOCKFILE:-true}" == 'true' ]]; then
  install_args+=(--frozen-lockfile)
fi

# Keep every credential except the registry token out of the dependency fetch,
# then remove that token before running any lifecycle script.
registry_token="${NODE_AUTH_TOKEN:-}"
unset NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN
unset ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
unset ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN ASTRALE_AUTONOMOUS_INSTALL_TOKEN

export STANDALONE=true

if [[ -n "$registry_token" ]]; then
  NODE_AUTH_TOKEN="$registry_token" pnpm "${install_args[@]}" --ignore-scripts
  unset registry_token

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
else
  unset registry_token
  pnpm "${install_args[@]}"
fi
