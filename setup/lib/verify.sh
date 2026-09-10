agent_verify() {
  repo_preflight
  cd "$AGENT_REPO_ROOT"
  [[ "$(node --version)" == "v$(agent_node_version)" ]] || agent_die 'Incorrect Node version'
  export npm_config_manage_package_manager_versions=false
  [[ "$(pnpm --version)" == "$(agent_pnpm_version)" ]] || agent_die 'Incorrect pnpm version'
  bun --version
  if [[ -f .bun-version ]]; then
    [[ "$(bun --version)" == "$(tr -d '[:space:]' < .bun-version)" ]] || agent_die 'Incorrect Bun version'
  fi
  [[ -f node_modules/.modules.yaml ]] || agent_die 'Repository dependencies are missing'
  pnpm exec oxlint --version
  pnpm exec oxfmt --version
  repo_verify
  node --input-type=module -e "await import('@astrale-os/ox/fmt'); await import('@astrale-os/ox/lint')"
  if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then
    agent_select_browser
    local tool harness skill
    for tool in playwright agent-browser chrome-devtools; do agent_check_browser "$tool"; done
    for harness in ${AGENT_HARNESSES//,/ }; do
      for skill in agent-browser chrome-devtools-cli; do
        node "$AGENT_SETUP_DIR/lib/skill-check.cjs" "$(agent_skill_directory "$harness")/$skill" "$skill"
      done
    done
  fi
  agent_log "Ready: $AGENT_SETUP_PROFILE"
}
