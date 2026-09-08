#!/usr/bin/env bash
# Read-only readiness check apart from disposable browser sessions; never installs anything.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
agent_load_config
agent_resolve_harnesses
cd "$AGENT_REPO_ROOT"

[[ "$#" == 0 ]] || agent_die 'Select verification harnesses with AGENT_HARNESSES=claude,codex'
export npm_config_manage_package_manager_versions=false
[[ "$(node --version)" == "v$(agent_node_version)" ]] || agent_die 'Node does not match .nvmrc'
[[ "$(pnpm --version)" == "$(agent_pnpm_version)" ]] || agent_die 'pnpm does not match packageManager'
node --version
pnpm --version
bun --version
[[ -f node_modules/.modules.yaml ]] || agent_die 'Repository dependencies are missing'
pnpm exec oxlint --version
pnpm exec oxfmt --version
pnpm exec tsc --version
node --input-type=module -e "await import('@astrale-os/ox/fmt'); await import('@astrale-os/ox/lint')"
if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then
  playwright --version
  agent-browser --version
  chrome-devtools --version
  agent_select_browser
  agent_check_browser playwright
  agent_check_browser agent-browser
  agent_check_browser chrome-devtools
else
  agent_log 'Browser tools and probes disabled by repository configuration'
fi
if [[ "$AGENT_SETUP_ASTRALE_CLI" == 1 ]]; then
  astrale --version
else
  agent_log 'Astrale CLI checks disabled by repository configuration'
fi
for harness in ${AGENT_HARNESSES//,/ }; do
  skill_directory="$(agent_skill_directory "$harness")"
  skills=()
  if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then skills+=(agent-browser chrome-devtools-cli); fi
  if [[ "$AGENT_SETUP_ASTRALE_CLI" == 1 ]]; then skills+=(astrale-cli astrale-domain); fi
  for skill in ${skills[@]+"${skills[@]}"}; do
    node "$SCRIPT_DIR/lib/skill-check.cjs" "$skill_directory/$skill" "$skill" ||
      agent_die "Missing/incomplete $harness skill: $skill"
  done
done
agent_log "Ready: Config runtimes, dependencies, local ox configuration and enabled tools/skills (harnesses: ${AGENT_HARNESSES:-none})"
