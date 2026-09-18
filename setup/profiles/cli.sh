# Product commands own asset generation; setup only composes preparation and readiness.
repo_preflight() {
  agent_check_repo
  local file version
  for file in .bun-version pnpm-workspace.yaml studio/package.json studio/e2e/fixture/package.json studio/e2e/fixture/peer/package.json scripts/build-embedded-assets.ts; do
    [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete CLI checkout: missing $file"
  done
  version="$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/.bun-version")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || agent_die '.bun-version must declare an exact Bun version'
  [[ "$AGENT_SETUP_ASTRALE_CLI" == 0 ]] || agent_die 'CLI does not install the released Astrale CLI'
}
repo_prepare() {
  pnpm run assets:ensure
  # Root (Viewer) and Studio may resolve different Playwright browser revisions.
  if [[ "$AGENT_SETUP_BROWSER" == 1 && "$AGENT_SETUP_TOOLS" != check ]]; then
    pnpm exec playwright install chromium
    pnpm --dir studio exec playwright install chromium
  fi
}
repo_verify() {
  pnpm exec tsc --version
  pnpm exec tsgo --version
  [[ -d studio/node_modules ]] || agent_die 'Studio dependencies are missing'
  pnpm --dir studio exec tsgo --version
  pnpm --dir studio exec vite --version
  [[ -s src/generated/embedded-assets.ts && -s viewer/dist/index.html && -s studio/client/dist/index.html ]] ||
    agent_die 'Embedded assets are missing; setup must prepare them'
  # Do not use bin/astrale.ts here: that launcher can regenerate stale assets.
  bun --eval 'import { embeddedAssetInputDigest, embeddedAssetCacheIsCurrent } from "./scripts/embedded-assets-cache.ts"; if (!(await embeddedAssetCacheIsCurrent(process.cwd(), await embeddedAssetInputDigest(process.cwd())))) throw new Error("Embedded assets are stale; run setup explicitly");'
  ASTRALE_TELEMETRY=0 bun bin/run.ts --version
  if [[ "$AGENT_SETUP_BROWSER" == 1 ]]; then
    local package
    for package in . studio; do
      pnpm --dir "$package" exec node --input-type=module -e 'import { chromium } from "@playwright/test"; const browser = await chromium.launch({headless:true}); try { const page = await browser.newPage(); await page.setContent("<title>CLI setup</title>"); if (await page.title() !== "CLI setup") throw new Error("Browser page probe failed"); } finally { await browser.close(); }'
    done
  fi
}
