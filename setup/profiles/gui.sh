repo_preflight() {
  agent_check_repo
  [[ -f "$AGENT_REPO_ROOT/pnpm-workspace.yaml" && -f "$AGENT_REPO_ROOT/desktop/package.json" ]] || agent_die 'Incomplete GUI checkout'
  [[ "$AGENT_SETUP_ASTRALE_CLI" == 0 ]] || agent_die 'GUI does not install the Astrale CLI'
}
repo_prepare() {
  local log
  log="$(mktemp)"
  if node "$AGENT_SETUP_DIR/lib/electron.cjs" --prepare > "$log" 2>&1; then
    cat "$log"; rm -f "$log"; return
  fi
  cat "$log" >&2
  # Chromium's current dependency list omits GTK 3, still required by Electron.
  # Repair only this diagnosed library; other launch failures remain visible.
  if [[ "$AGENT_SETUP_TOOLS" != install || "$(uname -s)" != Linux ]] ||
      ! grep -q 'libgtk-3.so.0: cannot open shared object file' "$log"; then
    rm -f "$log"; return 1
  fi
  rm -f "$log"
  source "$AGENT_SETUP_DIR/lib/browser.sh"
  mkdir -p "$AGENT_SETUP_HOME/logs/electron"
  agent_install_browser_dependencies "$(mktemp -d "$AGENT_SETUP_HOME/logs/electron/run.XXXXXX")" libgtk-3-0
  node "$AGENT_SETUP_DIR/lib/electron.cjs"
}
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
