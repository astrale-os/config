repo_preflight() {
  agent_check_repo
  local manifest
  for manifest in pnpm-workspace.yaml adapter-cloudflare/package.json adapter-astrale/package.json create-astrale-domain/package.json; do
    [[ -f "$AGENT_REPO_ROOT/$manifest" ]] || agent_die "Missing $manifest"
  done
  [[ "$AGENT_SETUP_BROWSER$AGENT_SETUP_ASTRALE_CLI" == 00 ]] || agent_die 'SDK uses neither global browsers nor Astrale CLI'
}
repo_prepare() { :; }
repo_verify() {
  local package
  for package in . adapter-cloudflare adapter-astrale create-astrale-domain; do
    [[ -d "$AGENT_REPO_ROOT/$package/node_modules" ]] || agent_die "Missing dependencies: $package"
    pnpm --dir "$package" exec tsc --version
  done
  pnpm exec tsc --version
  pnpm exec tsgo --version
  pnpm exec vitest --version
}
