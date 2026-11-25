# Codex Cloud starts shells in the mount, which can be the parent of the project.
agent_codex_defaults() {
  local repo
  repo="$(cd "$AGENT_REPO_ROOT" && pwd -P)"
  if [[ "${repo%/*}" != /workspace || ! -f "$repo/.astrale-workspace" ]]; then return 0; fi
  export AGENT_SETUP_CODEX_SCOPE=/workspace
  export AGENT_SETUP_HOME="${AGENT_SETUP_HOME:-/workspace/.astrale-tools/config-runner}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/workspace/.cache}"
  export XDG_DATA_HOME="${XDG_DATA_HOME:-/workspace/.local/share}"
  export npm_config_cache="${npm_config_cache:-$XDG_CACHE_HOME/npm}"
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$XDG_CACHE_HOME/ms-playwright}"
  if [[ ! -v ASTRALE_HOME && ! -d "$HOME/.astrale" ]]; then
    export ASTRALE_HOME="$AGENT_SETUP_HOME/astrale-state"
  fi
}

agent_validate_codex_extras() {
  local bun_version="${AGENT_CODEX_BUN_VERSION:-}" postgres_image="${AGENT_CODEX_POSTGRES_IMAGE:-}"
  [[ -z "$bun_version" || "$bun_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    agent_die 'AGENT_CODEX_BUN_VERSION must be an exact Bun version'
  [[ -z "$postgres_image" || "$postgres_image" =~ ^postgres@sha256:[a-f0-9]{64}$ ]] ||
    agent_die 'AGENT_CODEX_POSTGRES_IMAGE must be an immutable postgres digest'
}

agent_codex_docker() {
  if [[ "${AGENT_SETUP_CODEX_SCOPE:-}" == /workspace ]]; then
    env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
      docker --host=unix:///var/run/docker.sock "$@"
  else
    docker "$@"
  fi
}

agent_prepare_codex_extras() {
  local bun_version="${AGENT_CODEX_BUN_VERSION:-}" postgres_image="${AGENT_CODEX_POSTGRES_IMAGE:-}"
  if [[ -n "$bun_version" ]]; then agent_ensure_bun_version "$bun_version" bun-latest; fi
  if [[ -n "$postgres_image" ]]; then
    if ! agent_codex_docker image inspect "$postgres_image" >/dev/null 2>&1; then
      [[ "$AGENT_SETUP_TOOLS" != check ]] || agent_die "Preload $postgres_image, then rerun setup"
      agent_codex_docker pull "$postgres_image"
    fi
    if [[ "$AGENT_SETUP_TOOLS" != check ]]; then
      agent_codex_docker run --rm --pull=never --network none --entrypoint postgres "$postgres_image" --version
    fi
  fi
}
