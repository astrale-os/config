repo_preflight() {
  agent_check_repo
  local manifest
  for manifest in pnpm-workspace.yaml .bun-version; do
    [[ -f "$AGENT_REPO_ROOT/$manifest" ]] || agent_die "Incomplete PROTOTYPE checkout: missing $manifest"
  done
  [[ "$AGENT_SETUP_ASTRALE_CLI" == 0 ]] || agent_die 'PROTOTYPE does not install the Astrale CLI; keep AGENT_SETUP_ASTRALE_CLI=0'
}

repo_prepare() { :; }
repo_verify() {
pnpm exec tsc --version
pnpm exec vite --version
}
