# Published CLI preparation shared by repositories that operate Astrale instances.
agent_prepare_astrale() {
  [[ "$AGENT_SETUP_ASTRALE_CLI" == 1 ]] || return 0
  if [[ "$AGENT_SETUP_TOOLS" == check ]]; then
    astrale --version >/dev/null 2>&1 || agent_die 'Install the published Astrale CLI locally, then rerun setup'
    return
  fi
  if astrale --version >/dev/null 2>&1; then
    agent_link "$(command -v astrale)" astrale
  elif "${ASTRALE_HOME:-$HOME/.astrale}/bin/astrale" --version >/dev/null 2>&1; then
    agent_link "${ASTRALE_HOME:-$HOME/.astrale}/bin/astrale" astrale
  else
    node "$AGENT_SETUP_DIR/lib/install-astrale.cjs"
    agent_link "$AGENT_SETUP_HOME/astrale/bin/astrale" astrale
  fi
  astrale --version
}
