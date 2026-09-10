repo_preflight() {
  agent_check_repo
  local manifest
  for manifest in pnpm-workspace.yaml packages/ui/package.json registry/package.json playground/package.json domain/package.json; do
    [[ -f "$AGENT_REPO_ROOT/$manifest" ]] || agent_die "Incomplete UI checkout: missing $manifest"
  done
  [[ "$AGENT_SETUP_ASTRALE_CLI" == 0 ]] || agent_die 'UI does not install the Astrale CLI; keep AGENT_SETUP_ASTRALE_CLI=0'
}

repo_prepare() {
  local expected actual
  if ! command -v jq >/dev/null 2>&1; then agent_system_install jq; fi
# Direct Domain commands select its own pnpm pin; warm that runtime while network is available.
if [[ "$AGENT_SETUP_TOOLS" == check ]]; then
  # Check the existing secondary runtime without pnpm's implicit download.
  expected="$(node -p "require('./domain/package.json').packageManager.split('@')[1].split('+')[0]")"
  actual="$(cd domain && COREPACK_ENABLE_NETWORK=0 npm_config_manage_package_manager_versions=false pnpm --version 2>/dev/null || true)"
  [[ "$actual" == "$expected" ]] || agent_die "Prepare Domain pnpm $expected locally before rerunning setup"
else
  env npm_config_manage_package_manager_versions=true pnpm --dir domain --version
fi
# Consumers resolve the library's published dist exports during typechecks.
pnpm run build
# Project E2E uses its own pinned Playwright, independently of global browser tools.
if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then
  agent_select_browser
  pnpm --dir playground exec playwright install chromium
fi
}
repo_verify() {
jq --version
pnpm exec tsc --version
for package in packages/ui registry playground domain; do
  [[ -d "$package/node_modules" ]] || agent_die "Missing UI workspace dependencies: $package"
  pnpm --dir "$package" exec tsc --version
  pnpm --dir "$package" exec vitest --version
done
[[ -f packages/ui/dist/index.js && -f packages/ui/dist/index.d.ts && -f packages/ui/dist/theme.css ]] || agent_die 'UI library build is missing'
pnpm --dir playground exec vite --version
pnpm --dir domain exec bun --version
if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then
  pnpm --dir playground exec node --input-type=module -e 'import { chromium } from "@playwright/test"; const browser = await chromium.launch({headless:true}); await browser.close()'
fi
}
