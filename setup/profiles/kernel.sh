#!/usr/bin/env bash
# Kernel-owned requirements; shared runtime setup remains unchanged.
kernel_bun_version() {
  local version
  [[ -f "$AGENT_REPO_ROOT/.bun-version" ]] || agent_die 'Missing .bun-version'
  version="$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/.bun-version")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || agent_die '.bun-version must declare an exact Bun version'
  printf '%s\n' "$version"
}
# Preflight runs before Node/Bun installation. Kernel declares explicit package
# paths; reject syntax we cannot classify instead of treating an owned Test as absent.
kernel_workspace_packages() {
  [[ -f "$AGENT_REPO_ROOT/pnpm-workspace.yaml" ]] || agent_die 'Incomplete Kernel checkout: missing pnpm-workspace.yaml'
  awk '
    function invalid() { failed = 1; exit 1 }
    /^[[:space:]]*(#|$)/ { next }
    /^packages:[[:space:]]*(#.*)?$/ {
      if (seen) invalid()
      seen = 1; packages = 1; next
    }
    /^packages:/ { invalid() }
    /^[^[:space:]]/ { packages = 0 }
    !packages { next }
    {
      line = $0
      if (line !~ /^[[:space:]]+-[[:space:]]+/) invalid()
      sub(/^[[:space:]]+-[[:space:]]+/, "", line)
      sub(/[[:space:]]+#.*$/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (line ~ /^\047.*\047$/ || line ~ /^".*"$/) line = substr(line, 2, length(line) - 2)
      if (line !~ /^[[:alnum:]_.-]+(\/[[:alnum:]_.-]+)*$/) invalid()
      if (paths[line]++) invalid()
      if (line ~ /(^|\/)\.\.?($|\/)/) invalid()
      print line
    }
    END { if (failed || !seen) exit 1 }
  ' "$AGENT_REPO_ROOT/pnpm-workspace.yaml" || agent_die 'Kernel setup requires explicit workspace package paths'
}

kernel_workbench_owned() {
  local packages test=0 web=0 package
  packages="$(kernel_workspace_packages)" || agent_die 'Cannot determine Kernel workspace ownership'
  while IFS= read -r package; do
    case "$package" in
      test) test=1 ;;
      test/src/web) web=1 ;;
    esac
  done <<< "$packages"
  [[ "$test" == "$web" ]] || agent_die 'Incomplete Kernel workspace: Test and Web must be declared together'
  [[ "$test" == 1 ]]
}

repo_check_checkout() {
  local file package packages
  packages="$(kernel_workspace_packages)" || agent_die 'Cannot determine Kernel workspace ownership'
  for package in core dsl protocol ports runtime server host client backend __e2e__; do
    case $'\n'"$packages"$'\n' in
      *$'\n'"$package"$'\n'*) ;;
      *) agent_die "Incomplete Kernel workspace: missing package declaration $package" ;;
    esac
  done
  for file in pnpm-workspace.yaml core/package.json dsl/package.json protocol/package.json ports/package.json runtime/package.json server/package.json host/package.json client/package.json backend/package.json __e2e__/package.json; do
    [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete Kernel checkout: missing $file"
  done
  if kernel_workbench_owned; then
    for file in test/package.json test/src/web/package.json test/cli/build.mjs; do
      [[ -f "$AGENT_REPO_ROOT/$file" ]] || agent_die "Incomplete Kernel checkout: missing $file"
    done
  fi
  kernel_bun_version >/dev/null
}

# Standalone installation already builds this artifact in its root prepare hook.
# Integrated Workspace installation needs the same owner-specific build explicitly.
repo_prepare_workbench() {
  repo_check_checkout
  if kernel_workbench_owned; then pnpm --filter @astrale-os/kernel-test --fail-if-no-match run build:cli; fi
}

repo_preflight() {
  [[ "$AGENT_SETUP_BROWSER$AGENT_SETUP_ASTRALE_CLI" == 00 ]] || agent_die "Kernel uses neither browsers nor Astrale CLI"
  agent_check_repo
  repo_check_checkout
}

repo_prepare() {
if [[ "$KERNEL_SETUP_NATIVE_FALKORDB" == 1 ]]; then
  if [[ ! -e "$AGENT_REPO_ROOT/.context/falkordb-native" ]]; then
    agent_log 'Preparing native FalkorDB while setup has network access'
    if [[ "$AGENT_SETUP_TOOLS" == check ]]; then
      for tool in cc make tar; do command -v "$tool" >/dev/null || agent_die "Install $tool before native preparation"; done
    elif [[ "$(uname -s)" == Linux ]]; then
      agent_system_install build-essential libgomp1 libssl-dev
    fi
    (cd "$AGENT_REPO_ROOT" && NODE_USE_ENV_PROXY=1 pnpm falkordb:native:prepare)
  fi
  node "$PACKAGE_DIR/lib/kernel-native.cjs" "$AGENT_REPO_ROOT"
fi
if [[ "$KERNEL_SETUP_DOCKER" == 1 ]]; then
  source "$PACKAGE_DIR/lib/kernel-docker.sh"
  kernel_prepare_docker
fi
}
repo_verify() {
repo_check_checkout
pnpm exec tsc --version
pnpm exec tsgo --version
pnpm --dir host exec vitest --version
local packages="core dsl protocol ports runtime server host client backend __e2e__"
if kernel_workbench_owned; then
  pnpm --dir test exec vitest --version
  packages="$packages test test/src/web"
fi
for package in $packages; do
  [[ -d "$package/node_modules" ]] || agent_die "Missing Kernel workspace dependencies: $package"
  pnpm --dir "$package" exec tsc --version
done
if kernel_workbench_owned; then
  [[ -s test/dist/cli/kernel-test.mjs && -s test/dist/cli/inputs.json ]] || agent_die 'Prepared kernel-test bundle is missing'
  # Invoke the built artifact directly; the source launcher can rebuild it.
  KERNEL_TEST_SOURCE_ROOT="$AGENT_REPO_ROOT/test" node test/dist/cli/kernel-test.mjs --help
fi
pnpm exec cg --version
if [[ "$KERNEL_SETUP_NATIVE_FALKORDB" == 1 ]]; then node "$PACKAGE_DIR/lib/kernel-native.cjs" "$AGENT_REPO_ROOT"; fi
if [[ "$KERNEL_SETUP_DOCKER" == 1 ]]; then
  source "$PACKAGE_DIR/lib/kernel-docker.sh"
  docker info >/dev/null
  docker compose version
  docker image inspect "$(kernel_docker_image)" >/dev/null
fi
}
repo_fingerprint() {
  printf '%s\0%s\0' "$KERNEL_SETUP_NATIVE_FALKORDB" "$KERNEL_SETUP_DOCKER"
  local file
  for file in scripts/integration/native-pins.json scripts/integration/prepare-native.ts backend/falkordb/evidence/lib/falkordb.mjs; do
    printf '%s\0' "$file"
    if [[ -f "$AGENT_REPO_ROOT/$file" ]]; then cat "$AGENT_REPO_ROOT/$file"; fi
  done
}
repo_environment() {
  printf 'export KERNEL_SETUP_NATIVE_FALKORDB=%q KERNEL_SETUP_DOCKER=%q\n' "$KERNEL_SETUP_NATIVE_FALKORDB" "$KERNEL_SETUP_DOCKER"
}

repo_resume() {
  if [[ "$KERNEL_SETUP_DOCKER" == 1 ]]; then
    source "$PACKAGE_DIR/lib/kernel-docker.sh"
    kernel_resume_docker
  fi
}
