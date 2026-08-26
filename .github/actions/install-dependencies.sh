#!/usr/bin/env bash
set -euo pipefail

install_args=(install)
if [[ "${INSTALL_FROZEN_LOCKFILE:-true}" == 'true' ]]; then
  install_args+=(--frozen-lockfile)
fi

# Keep every credential except the registry token out of the dependency fetch.
# When that token is present, this process must exit with the script-free install;
# lifecycle scripts are started by a separate, credential-free action step.
unset NPM_TOKEN GH_TOKEN GITHUB_TOKEN
unset ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
unset ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN ASTRALE_AUTONOMOUS_INSTALL_TOKEN

export STANDALONE=true

if [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
  exec pnpm "${install_args[@]}" --ignore-scripts
fi

unset NODE_AUTH_TOKEN
exec pnpm "${install_args[@]}"
