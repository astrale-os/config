#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  printf 'run-token-free.sh requires a command.\n' >&2
  exit 2
fi

unset NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN
unset ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
unset ASTRALE_EPHEMERAL_GITHUB_APP_TOKEN ASTRALE_AUTONOMOUS_INSTALL_TOKEN
unset NPM_CONFIG_USERCONFIG npm_config_userconfig
unset NPM_CONFIG_GLOBALCONFIG npm_config_globalconfig
unset NPM_CONFIG_REGISTRY npm_config_registry

umask 077
token_free_root="$(mktemp -d)"
trap 'rm -rf "$token_free_root"' EXIT
token_free_userconfig="$token_free_root/npmrc.user"
token_free_globalconfig="$token_free_root/npmrc.global"
: > "$token_free_globalconfig"
{
  printf '%s\n' 'registry=https://registry.npmjs.org/'
  printf '%s\n' '@astrale-os:registry=https://registry.npmjs.org/'
  printf '%s\n' '@astrale-domains:registry=https://registry.npmjs.org/'
  printf '%s\n' '@astrale:registry=https://registry.npmjs.org/'
  printf '%s\n' '@jsr:registry=https://npm.jsr.io/'
  printf '%s\n' 'always-auth=false'
} > "$token_free_userconfig"

export NPM_CONFIG_USERCONFIG="$token_free_userconfig"
export npm_config_userconfig="$token_free_userconfig"
export NPM_CONFIG_GLOBALCONFIG="$token_free_globalconfig"
export npm_config_globalconfig="$token_free_globalconfig"
export NPM_CONFIG_REGISTRY='https://registry.npmjs.org/'
export npm_config_registry='https://registry.npmjs.org/'
export NPM_CONFIG_OFFLINE='true'
export npm_config_offline='true'

"$@"
