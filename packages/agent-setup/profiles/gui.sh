repo_preflight() {
  agent_check_repo
  [[ -f "$AGENT_REPO_ROOT/pnpm-workspace.yaml" && -f "$AGENT_REPO_ROOT/desktop/package.json" ]] || agent_die 'Incomplete GUI checkout'
  [[ "$AGENT_SETUP_ASTRALE_CLI" == 0 ]] || agent_die 'GUI does not install the Astrale CLI'
}
repo_prepare() { node "$AGENT_SETUP_DIR/lib/electron.cjs" --prepare; }
repo_verify() {
  [[ -d desktop/node_modules ]] || agent_die 'Missing Desktop dependencies'
  node "$AGENT_SETUP_DIR/lib/electron.cjs"
  pnpm exec tsgo --version
  pnpm exec vitest --version
  pnpm exec vite --version
  pnpm --dir desktop exec tsgo --version
  pnpm --dir desktop exec vitest --version
  pnpm --dir desktop exec electron-vite --version
}
