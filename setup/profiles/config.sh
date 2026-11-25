# Config ships configuration files and prebuilt JavaScript; no setup build is needed.
repo_preflight() {
  agent_check_repo
  [[ -f "$AGENT_REPO_ROOT/pnpm-workspace.yaml" ]] || agent_die 'Missing pnpm-workspace.yaml'
  [[ -f "$AGENT_REPO_ROOT/packages/ox/package.json" ]] || agent_die 'Missing local ox package'
  [[ "$AGENT_SETUP_BROWSER$AGENT_SETUP_ASTRALE_CLI" == 00 ]] || agent_die 'Config uses neither global browsers nor Astrale CLI'
}
repo_prepare() { :; }
repo_verify() {
  if [[ "$AGENT_SETUP_PROFILE" == workspace ]]; then
    # The integrated checkout installs only Config's Ox package.
    node --input-type=module -e 'await import("./packages/ox/fmt.js"); await import("./packages/ox/lint.js")'
    return
  fi
  pnpm exec tsc --version
  # Common verification also imports both local ox configuration exports.
}
