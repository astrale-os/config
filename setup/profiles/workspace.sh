# Explicit composition: shared tools once, three dependency roots, then product artifacts.
source "$PACKAGE_DIR/lib/workspace.sh"
repo_preflight() {
  agent_check_repo
  [[ -f "$AGENT_REPO_ROOT/.gitmodules" && -f "$AGENT_REPO_ROOT/.astrale-workspace" ]] || agent_die 'Missing Workspace manifests'
}
repo_checkout() {
  workspace_update_main
  workspace_check_manifests
  local repo version
  version="$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/.bun-version")"
  for repo in cli kernel prototype; do
    [[ "$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/$repo/.bun-version")" == "$version" ]] || agent_die "$repo Bun pin differs from Workspace; review the shared runtime"
  done
}
repo_dependencies() {
  local root="$AGENT_REPO_ROOT" repo version prefix
  # Publish the root pnpm link for lifecycle scripts and subsequent sessions.
  agent_ensure_pnpm
  # Warm exact product pnpm versions without replacing the Workspace activation link.
  for repo in . admin cli config datastore domains gui kernel prototype sdk shell ui ui/domain; do
    version="$(AGENT_REPO_ROOT="$root/$repo" agent_pnpm_version)"
    prefix="$AGENT_SETUP_HOME/pnpm/$version"
    if [[ "$("$prefix/bin/pnpm" --version 2>/dev/null || true)" != "$version" ]]; then
      if [[ "$AGENT_SETUP_TOOLS" == check ]]; then
        [[ "$(cd "$root/$repo" && npm_config_manage_package_manager_versions=false pnpm --version 2>/dev/null || true)" == "$version" ]] || agent_die "Prepare pnpm $version locally for $repo"
      else
        agent_npm_install "$prefix" "pnpm@$version"
      fi
    fi
  done
  # Never replace integrated links with standalone product installs.
  unset STANDALONE
  for repo in . domains gui; do
    workspace_pnpm "$root/$repo" install --no-frozen-lockfile --prefer-offline
  done
}
workspace_profile() (
  local product="$1" operation="$2"
  export AGENT_REPO_ROOT="$AGENT_REPO_ROOT/$product"
  cd "$AGENT_REPO_ROOT"
  source "$PACKAGE_DIR/profiles/$product.sh"
  pnpm() { workspace_pnpm "$PWD" "$@"; }
  "repo_$operation"
)
repo_prepare() {
  # Source-only products need no artifact step. Admin supplies local SSH tooling.
  workspace_profile admin prepare
  workspace_profile ui prepare
  workspace_profile gui prepare
  workspace_pnpm "$AGENT_REPO_ROOT/kernel" --filter @astrale-os/kernel-test run build:cli
  workspace_profile kernel prepare
  workspace_profile cli prepare
  workspace_pnpm "$AGENT_REPO_ROOT/cli" run build
  if [[ "$AGENT_SETUP_TOOLS" != check ]]; then agent_link "$AGENT_REPO_ROOT/scripts/astrale-dev" astrale-dev; fi
}
repo_verify() {
  workspace_check_manifests
  local repo
  for repo in . domains gui; do
    [[ -f "$repo/node_modules/.modules.yaml" ]] || agent_die "Missing dependency root: $repo"
  done
  for repo in config sdk shell admin datastore cli kernel ui prototype domains gui; do
    [[ -d "$repo/node_modules" ]] || agent_die "Missing product dependencies: $repo"
    workspace_profile "$repo" verify
  done
  for repo in cli kernel prototype; do
    [[ "$(bun --version)" == "$(tr -d '[:space:]' < "$repo/.bun-version")" ]] || agent_die "Wrong Bun for $repo"
  done
  ASTRALE_TELEMETRY=0 bun cli/dist/astrale.js --version
  # Read-only source invocation: the CLI profile already checked its asset cache.
  ASTRALE_TELEMETRY=0 bash scripts/astrale-dev --version
  for repo in $(workspace_paths); do agent_log "$repo $(git -C "$repo" rev-parse --short HEAD)"; done
}
repo_fingerprint() {
  local root="$AGENT_REPO_ROOT" repo
  printf '%s\0%s\0' "$KERNEL_SETUP_NATIVE_FALKORDB" "$KERNEL_SETUP_DOCKER"
  # Root Git does not enumerate files within submodules. Include each child's inputs,
  # but not HEAD or source edits, so normal development does not refresh branches.
  for repo in $(workspace_paths); do
    printf '%s\0' "$repo"
    if [[ -e "$root/$repo/.git" ]]; then
      ( export AGENT_REPO_ROOT="$root/$repo"; unset -f repo_fingerprint; agent_setup_fingerprint )
    fi
  done
  ( export AGENT_REPO_ROOT="$root/kernel"; source "$PACKAGE_DIR/profiles/kernel.sh"; repo_fingerprint )
}
repo_environment() {
  printf 'export KERNEL_SETUP_NATIVE_FALKORDB=%q KERNEL_SETUP_DOCKER=%q\n' "$KERNEL_SETUP_NATIVE_FALKORDB" "$KERNEL_SETUP_DOCKER"
}

repo_resume() { workspace_profile kernel resume; }
