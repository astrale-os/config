repo_preflight() {
  [[ "$AGENT_SETUP_BROWSER$AGENT_SETUP_ASTRALE_CLI" == 00 ]] || agent_die "Datastore uses neither browsers nor Astrale CLI"
  agent_check_repo
  local manifest
  for manifest in pnpm-workspace.yaml client/package.json server/package.json adapters/in-memory/package.json adapters/cloudflare/package.json __tests__/package.json; do
    [[ -f "$AGENT_REPO_ROOT/$manifest" ]] || agent_die "Incomplete Datastore checkout: missing $manifest"
  done
}

repo_prepare() { :; }
repo_verify() {
pnpm --dir __tests__ exec vitest --version
for package in client server adapters/in-memory adapters/cloudflare __tests__; do
  [[ -d "$package/node_modules" ]] || agent_die "Missing Datastore workspace dependencies: $package"
  pnpm --dir "$package" exec tsc --version
done
}
