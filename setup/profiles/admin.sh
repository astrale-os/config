#!/usr/bin/env bash
# Admin workspace requirements.
ADMIN_PACKAGES=(auth registry router console console/web invitation test test/web domain worker)

repo_preflight() {
  agent_check_repo
  local package
  [[ -f "$AGENT_REPO_ROOT/pnpm-workspace.yaml" ]] || agent_die 'Incomplete Admin checkout: missing pnpm-workspace.yaml'
  for package in "${ADMIN_PACKAGES[@]}"; do
    [[ -f "$AGENT_REPO_ROOT/$package/package.json" ]] || agent_die "Incomplete Admin checkout: missing $package/package.json"
  done
}

repo_prepare() {
  # The Domain's local SSH authority tests generate disposable Ed25519 keys.
  if ! command -v ssh-keygen >/dev/null 2>&1; then agent_system_install openssh-client; fi
}
repo_verify() {
command -v ssh-keygen >/dev/null || agent_die "Missing ssh-keygen (OpenSSH client)"
pnpm exec tsc --version
# Admin has no package-local Bun dependency. Check the tools each package actually declares;
# console/test frontends use Vite, only some packages use Vitest, and Workers use Wrangler.
for package in "${ADMIN_PACKAGES[@]}"; do
  [[ -d "$package/node_modules" ]] || agent_die "Admin workspace dependencies are missing: $package"
  package_tools="$(node - "$package/package.json" <<'NODE'
const fs = require('node:fs')
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
for (const [name, binary] of Object.entries({ typescript: 'tsc', vitest: 'vitest', vite: 'vite', wrangler: 'wrangler' })) {
  if (dependencies[name]) console.log(binary)
}
NODE
)"
  for tool in $package_tools; do
    pnpm --dir "$package" exec "$tool" --version
  done
done
# The SDK's local build CLI exposes --help, not --version; it is needed even with global CLI off.
pnpm --dir domain exec astrale-domain --help >/dev/null
}
