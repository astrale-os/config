# Domain packages own their SDK commands; setup does not build or deploy domains.
repo_preflight() {
  agent_check_repo
  local file
  for file in pnpm-workspace.yaml issues/package.json; do
    [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete Domains checkout: missing $file"
  done
}
repo_prepare() { :; }
repo_verify() {
  local expected_bun
  expected_bun="$(node -p "JSON.parse(require('fs').readFileSync('issues/package.json', 'utf8')).devDependencies.bun")"
  [[ "$(pnpm --dir issues exec bun --version)" == "$expected_bun" ]] || agent_die 'Package-local Bun is missing or incorrect'
}
