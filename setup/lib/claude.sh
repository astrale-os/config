agent_claude() {
  if [[ "${CLAUDE_CODE_REMOTE:-}" == true ]]; then
    export AGENT_HARNESSES=claude AGENT_SETUP_TOOLS=install
    command -v flock >/dev/null || agent_die 'Claude cloud requires flock'
    local state="$AGENT_SETUP_HOME/state/claude" marker fingerprint temporary
    mkdir -p "$state"
    marker="$state/$AGENT_CHECKOUT_KEY.ready"
    (
      flock -x -w 600 9 || agent_die 'Timed out waiting for setup'
      fingerprint="$(agent_setup_fingerprint)"
      if [[ -r "$AGENT_ENV_FILE" && -f "$marker" && "$(cat "$marker")" == "$fingerprint" ]]; then
        agent_log 'Prepared checkout: loading paths and resuming services' >&2
        source "$AGENT_ENV_FILE"
        if declare -F repo_resume >/dev/null; then repo_resume >&2; fi
      else
        rm -f "$marker"
        agent_prepare >&2
        temporary="$(mktemp "$state/ready.XXXXXX")"
        trap 'rm -f "$temporary"' EXIT
        agent_setup_fingerprint > "$temporary"
        mv "$temporary" "$marker"
        printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}\n'
      fi
    ) 9> "$state/$AGENT_CHECKOUT_KEY.lock"
  fi
  if [[ -r "$AGENT_ENV_FILE" && -n "${CLAUDE_ENV_FILE:-}" ]] && ! grep -Fqx "$(agent_environment_reference)" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    agent_environment_reference >> "$CLAUDE_ENV_FILE"
  fi
}
