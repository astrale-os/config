# Source-exporting workspace packages need dependencies, not publication builds.
repo_preflight() {
  agent_check_repo
  local file
  for file in pnpm-workspace.yaml domain/package.json packages/shell/package.json packages/shell-react/package.json; do
    [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete Shell checkout: missing $file"
  done
}
repo_prepare() { :; }
repo_verify() {
  local expected_bun package
  expected_bun="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).devDependencies.bun")"
  [[ "$(pnpm exec bun --version)" == "$expected_bun" ]] || agent_die 'Repository-local Bun is missing or incorrect'
  pnpm exec astrale-domain --help >/dev/null
  for package in domain packages/shell packages/shell-react; do
    [[ -d "$package/node_modules" ]] || agent_die "Shell workspace dependencies are missing: $package"
    pnpm --dir "$package" exec vitest --version
  done
}
