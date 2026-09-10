#!/usr/bin/env bash
# Workspace-owned Git policy. No reset/clean/stash, and never commit gitlinks.
workspace_paths() {
  git -C "$AGENT_REPO_ROOT" config --file .gitmodules --get-regexp '^submodule\..*\.path$' |
    while read -r key path; do
      # The explicit preparation below covers these eleven repositories only.
      case "$path" in
        admin|cli|config|datastore|domains|gui|kernel|prototype|sdk|shell|ui) printf '%s\n' "$path" ;;
        *) agent_die "Unreviewed submodule path: $path; update Workspace preparation first" ;;
      esac
    done
}

workspace_preflight() {
  agent_check_repo
  [[ -f "$AGENT_REPO_ROOT/.gitmodules" && -f "$AGENT_REPO_ROOT/.astrale-workspace" ]] ||
    agent_die 'Missing Workspace manifests'
  local path paths
  paths="$(workspace_paths)" || return
  [[ "$(printf '%s\n' "$paths" | sort -u | wc -l | tr -d ' ')" == 11 ]] ||
    agent_die 'Expected eleven distinct Workspace submodules'
  while read -r path; do
    # An empty, uninitialized directory is fine. Existing work is never discarded.
    if [[ -e "$AGENT_REPO_ROOT/$path/.git" ]]; then
      [[ -z "$(git -C "$AGENT_REPO_ROOT/$path" status --porcelain --untracked-files=all)" ]] ||
        agent_die "$path has local changes; commit or move them before explicit setup"
    elif [[ -d "$AGENT_REPO_ROOT/$path" && -n "$(ls -A "$AGENT_REPO_ROOT/$path")" ]]; then
      agent_die "$path is nonempty but not an initialized submodule"
    fi
  done <<< "$paths"
}

workspace_update_main() {
  workspace_preflight
  local path directory target current paths
  paths="$(workspace_paths)"
  git -C "$AGENT_REPO_ROOT" submodule sync
  # Fetch/check every existing checkout before switching any of them. Unique local
  # commits (including commits on local main) cause an error, never a forced reset.
  while read -r path; do
    directory="$AGENT_REPO_ROOT/$path"
    if [[ ! -e "$directory/.git" ]]; then
      # --remote selects origin/main, explicitly NOT the recorded workspace gitlink.
      git -C "$AGENT_REPO_ROOT" -c "submodule.$path.branch=main" submodule update --init --remote -- "$path"
    fi
    git -C "$directory" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
    target="$(git -C "$directory" rev-parse refs/remotes/origin/main)"
    for current in HEAD refs/heads/main; do
      if git -C "$directory" rev-parse --verify "$current" >/dev/null 2>&1; then
        git -C "$directory" merge-base --is-ancestor "$current" "$target" ||
          agent_die "$path $current has commits outside fetched main; refusing to overwrite them"
      fi
    done
    # Nested submodules need a separately reviewed install policy, not implicit pin changes.
    [[ ! -f "$directory/.gitmodules" ]] || agent_die "$path gained nested submodules; review their setup policy"
  done <<< "$paths"
  while read -r path; do
    directory="$AGENT_REPO_ROOT/$path"
    if git -C "$directory" show-ref --verify --quiet refs/heads/main; then
      git -C "$directory" switch main
      git -C "$directory" merge --ff-only refs/remotes/origin/main
    else
      git -C "$directory" switch --track -c main refs/remotes/origin/main
    fi
    agent_log "$path main $(git -C "$directory" rev-parse HEAD)"
  done <<< "$paths"
}

workspace_check_manifests() {
  local path
  for path in $(workspace_paths); do
    [[ -f "$AGENT_REPO_ROOT/$path/package.json" ]] || agent_die "Missing $path/package.json"
    [[ "$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/$path/.nvmrc")" == "$(agent_node_version)" ]] ||
      agent_die "$path needs a different Node version; review shared Workspace runtime"
  done
}

# Run a product's commands with its pinned pnpm without changing the shared pnpm link.
workspace_pnpm() {
  local directory="$1" version
  shift
  version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).packageManager.split('@')[1].split('+')[0]" "$directory/package.json")"
  local binary="$AGENT_SETUP_HOME/pnpm/$version/bin/pnpm"
  if [[ ! -x "$binary" ]]; then
    binary="$(type -P pnpm)"
    [[ "$(cd "$directory" && npm_config_manage_package_manager_versions=false "$binary" --version)" == "$version" ]] || agent_die "Missing pnpm $version for $directory"
  fi
  (cd "$directory" && npm_config_manage_package_manager_versions=false "$binary" "$@")
}
