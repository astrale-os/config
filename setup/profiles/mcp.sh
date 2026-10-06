# Autonomous Worker package: dependencies only; `pnpm build` is a Wrangler dry-run deploy.
repo_preflight() {
  agent_check_repo
  local file
  for file in pnpm-workspace.yaml wrangler.jsonc; do
    [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete MCP checkout: missing $file"
  done
  [[ "$AGENT_SETUP_BROWSER$AGENT_SETUP_ASTRALE_CLI" == 00 ]] || agent_die 'MCP uses neither browsers nor Astrale CLI'
}
repo_prepare() { :; }
repo_verify() {
  [[ -d node_modules ]] || agent_die 'Missing MCP dependencies'
  pnpm exec tsc --version
  pnpm exec vitest --version
  pnpm exec wrangler --version
}
