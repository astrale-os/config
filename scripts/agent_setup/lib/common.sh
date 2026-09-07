#!/usr/bin/env bash
# Shared source: astrale-os/config. Sync explicitly; never fetch setup code at runtime.
set -euo pipefail

AGENT_SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_REPO_ROOT="$(cd "$AGENT_SETUP_DIR/../.." && pwd)"
AGENT_SETUP_HOME="${AGENT_SETUP_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/astrale-agent-setup}"
AGENT_BIN="$AGENT_SETUP_HOME/bin"
AGENT_TOOLS="$AGENT_SETUP_HOME/tools"
AGENT_ENV_FILE="$AGENT_SETUP_HOME/env.sh"
export AGENT_SETUP_HOME AGENT_BIN AGENT_TOOLS
export PATH="$AGENT_BIN:$AGENT_TOOLS/bin:${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
export CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1

agent_log() { printf '[agent-setup] %s\n' "$*"; }
agent_die() { printf '[agent-setup] ERROR: %s\n' "$*" >&2; exit 1; }

agent_system_install() {
  if [[ "$(uname -s)" != Linux ]] || ! command -v apt-get >/dev/null 2>&1; then
    agent_die "Install these system dependencies, then retry: $*"
  fi
  local elevate=()
  if [[ "$(id -u)" != 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true; then
      agent_die "Installing system dependencies requires root or passwordless sudo: $*"
    fi
    elevate=(sudo -n)
  fi
  "${elevate[@]}" apt-get update -qq
  "${elevate[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

agent_bootstrap_system() {
  local command_name missing=0
  for command_name in curl git tar gzip unzip; do
    command -v "$command_name" >/dev/null 2>&1 || missing=1
  done
  if [[ "$missing" == 1 ]]; then
    agent_system_install ca-certificates curl git tar gzip unzip
  fi
  if [[ "$(uname -s)" == Linux ]] &&
    { ! command -v make >/dev/null 2>&1 || ! command -v c++ >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; }; then
    agent_system_install build-essential python3
  fi
  mkdir -p "$AGENT_BIN" "$AGENT_TOOLS"
}

agent_link() {
  local target="$1" name="$2"
  [[ "$target" == "$AGENT_BIN/$name" ]] && return 0
  [[ -x "$target" ]] || agent_die "Not executable: $target"
  mkdir -p "$AGENT_BIN"
  ln -sfn "$target" "$AGENT_BIN/$name"
  hash -r
}

agent_node_version() {
  local version
  [[ -f "$AGENT_REPO_ROOT/.nvmrc" ]] || agent_die "Missing .nvmrc in $AGENT_REPO_ROOT"
  version="$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/.nvmrc")"
  version="${version#v}"
  [[ "$version" =~ ^26\.[0-9]+\.[0-9]+$ ]] ||
    agent_die ".nvmrc must declare an exact Node 26 version (got: $version)"
  if [[ -f "$AGENT_REPO_ROOT/.node-version" ]]; then
    local other
    other="$(tr -d '[:space:]' < "$AGENT_REPO_ROOT/.node-version")"
    [[ "${other#v}" == "$version" ]] || agent_die ".node-version disagrees with .nvmrc"
  fi
  printf '%s\n' "$version"
}

agent_ensure_node() {
  local version actual os arch destination archive temporary checksum
  version="$(agent_node_version)"
  actual="$(node --version 2>/dev/null || true)"
  if [[ "$actual" == "v$version" ]] && npm --version >/dev/null 2>&1; then
    agent_link "$(command -v node)" node
    agent_link "$(command -v npm)" npm
    agent_log "Reusing Node $actual"
    return
  fi
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) agent_die "Unsupported operating system for Node" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) agent_die "Unsupported architecture for Node" ;;
  esac
  destination="$AGENT_SETUP_HOME/node/node-v$version-$os-$arch"
  if [[ "$("$destination/bin/node" --version 2>/dev/null || true)" != "v$version" ]] ||
    ! PATH="$destination/bin:$PATH" "$destination/bin/npm" --version >/dev/null 2>&1; then
    agent_log "Installing Node $version"
    archive="node-v$version-$os-$arch.tar.gz"
    temporary="$(mktemp -d)"
    # A failed download never replaces a working runtime.
    (
      trap 'rm -rf "$temporary"' EXIT
      cd "$temporary"
      curl --fail --location --silent --show-error --retry 2 "https://nodejs.org/dist/v$version/$archive" -o "$archive"
      curl --fail --location --silent --show-error --retry 2 "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o SHASUMS256.txt
      checksum="$(awk -v file="$archive" '$2 == file { print $1 }' SHASUMS256.txt)"
      [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || agent_die "Missing Node archive checksum"
      if command -v sha256sum >/dev/null 2>&1; then
        printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
      else
        printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -
      fi
      tar -xzf "$archive"
      [[ "$("node-v$version-$os-$arch/bin/node" --version)" == "v$version" ]] || agent_die "Downloaded Node is unusable"
      mkdir -p "$(dirname "$destination")"
      rm -rf "$destination"
      mv "node-v$version-$os-$arch" "$destination"
    )
  fi
  agent_link "$destination/bin/node" node
  agent_link "$destination/bin/npm" npm
  [[ "$(node --version)" == "v$version" ]] || agent_die "Node version remains incorrect"
  npm --version >/dev/null
}

agent_npm_install() {
  local prefix="$1"
  shift
  # Browser downloads belong exclusively to env_1, including transitive postinstalls.
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=true \
    npm install --global --prefix "$prefix" --no-audit --no-fund "$@"
}

agent_ensure_bun() {
  if bun --version >/dev/null 2>&1; then
    agent_link "$(command -v bun)" bun
    agent_log "Reusing Bun $(bun --version)"
    return
  fi
  agent_log "Installing the current Bun release"
  agent_npm_install "$AGENT_SETUP_HOME/bun" bun@latest
  agent_link "$AGENT_SETUP_HOME/bun/bin/bun" bun
  bun --version
}

agent_ensure_cli() {
  local name="$1" package="$2"
  if "$name" --version >/dev/null 2>&1; then
    agent_link "$(command -v "$name")" "$name"
    agent_log "Reusing $name"
  else
    agent_log "Installing $package@latest"
    agent_npm_install "$AGENT_TOOLS" "$package@latest"
    agent_link "$AGENT_TOOLS/bin/$name" "$name"
  fi
  "$name" --version >/dev/null || agent_die "$name is unusable after installation"
}

agent_pnpm_version() {
  node - "$AGENT_REPO_ROOT/package.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).packageManager;
const match = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha\d+\.[a-f0-9]+)?$/.exec(value ?? '');
if (!match) throw new Error('package.json#packageManager must declare an exact pnpm version');
console.log(match[1]);
NODE
}

agent_ensure_pnpm() {
  local version prefix
  version="$(agent_pnpm_version)"
  # Disable pnpm's implicit version download: this function owns activation and verification.
  export npm_config_manage_package_manager_versions=false
  if [[ "$(pnpm --version 2>/dev/null || true)" != "$version" ]]; then
    prefix="$AGENT_SETUP_HOME/pnpm/$version"
    if [[ "$("$prefix/bin/pnpm" --version 2>/dev/null || true)" != "$version" ]]; then
      agent_log "Installing pnpm $version"
      agent_npm_install "$prefix" "pnpm@$version"
    fi
    agent_link "$prefix/bin/pnpm" pnpm
  else
    agent_link "$(command -v pnpm)" pnpm
  fi
  [[ "$(pnpm --version)" == "$version" ]] || agent_die "pnpm version remains incorrect (expected $version)"
  agent_log "Verified pnpm $version in $AGENT_REPO_ROOT"
}

agent_playwright_module() {
  node "$AGENT_SETUP_DIR/lib/browser-check.cjs" module "$(command -v playwright)"
}

agent_select_browser() {
  export AGENT_PLAYWRIGHT_MODULE
  AGENT_PLAYWRIGHT_MODULE="$(agent_playwright_module)"
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$AGENT_SETUP_HOME/browsers}"
  export AGENT_BROWSER_EXECUTABLE_PATH
  AGENT_BROWSER_EXECUTABLE_PATH="$(node "$AGENT_SETUP_DIR/lib/browser-check.cjs" executable)"
  export CHROME_DEVTOOLS_EXECUTABLE_PATH="$AGENT_BROWSER_EXECUTABLE_PATH"
}

agent_check_browser() {
  node "$AGENT_SETUP_DIR/lib/browser-check.cjs" "$1"
}

agent_skill_directory() {
  case "$1" in
    codex) printf '%s/.agents/skills\n' "$HOME" ;;
    claude-code) printf '%s/skills\n' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
    *) agent_die "Unsupported skills target: $1" ;;
  esac
}

agent_ensure_skill() {
  local agent="$1" source="$2" name="$3" destination
  destination="$(agent_skill_directory "$agent")/$name"
  if node "$AGENT_SETUP_DIR/lib/skill-check.cjs" "$destination" "$name"; then
    agent_log "Reusing $name skill for $agent"
    return
  fi
  agent_ensure_cli skills skills
  skills add "$source" --skill "$name" --agent "$agent" --global --copy --yes
  node "$AGENT_SETUP_DIR/lib/skill-check.cjs" "$destination" "$name" ||
    agent_die "Skill $name for $agent is missing or incomplete after installation"
}

agent_persist_environment() {
  mkdir -p "$AGENT_SETUP_HOME"
  local file line temporary
  temporary="$(mktemp "$AGENT_SETUP_HOME/env.XXXXXX")"
  {
    printf '# Generated by Astrale agent setup; contains paths only.\n'
    printf 'export AGENT_SETUP_HOME=%q\n' "$AGENT_SETUP_HOME"
    # shellcheck disable=SC2016 # Expand PATH in the future shell, never capture the setup shell.
    printf 'export PATH=%q:%q:"$PATH"\n' "$AGENT_BIN" "$AGENT_TOOLS/bin"
    if [[ -n "${AGENT_BROWSER_EXECUTABLE_PATH:-}" ]]; then
      printf 'export PLAYWRIGHT_BROWSERS_PATH=%q\n' "$PLAYWRIGHT_BROWSERS_PATH"
      printf 'export AGENT_BROWSER_EXECUTABLE_PATH=%q\n' "$AGENT_BROWSER_EXECUTABLE_PATH"
      printf 'export CHROME_DEVTOOLS_EXECUTABLE_PATH=%q\n' "$CHROME_DEVTOOLS_EXECUTABLE_PATH"
      printf 'export AGENT_PLAYWRIGHT_MODULE=%q\n' "$AGENT_PLAYWRIGHT_MODULE"
    fi
  } > "$temporary"
  mv "$temporary" "$AGENT_ENV_FILE"
  printf -v line '[ ! -f %q ] || . %q # Astrale agent setup' "$AGENT_ENV_FILE" "$AGENT_ENV_FILE"
  for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zprofile" "$HOME/.zshrc"; do
    if ! grep -Fqx "$line" "$file" 2>/dev/null; then
      if [[ "$file" == "$HOME/.bashrc" ]]; then
        # Stock Linux bashrc returns early in non-interactive shells.
        temporary="$(mktemp)"
        printf '%s\n' "$line" > "$temporary"
        if [[ -f "$file" ]]; then cat "$file" >> "$temporary"; fi
        cat "$temporary" > "$file"
        rm -f "$temporary"
      else
        printf '\n%s\n' "$line" >> "$file"
      fi
    fi
  done
  if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf '\n%s\n' "$line" >> "$CLAUDE_ENV_FILE"
  fi
  agent_log "Shell environment: $AGENT_ENV_FILE"
}

agent_install_repo() {
  cd "$AGENT_REPO_ROOT"
  [[ -f pnpm-lock.yaml ]] || agent_die "Missing pnpm-lock.yaml; generate and review it outside setup"
  local before_head before_branch
  before_head="$(git rev-parse HEAD)"
  before_branch="$(git symbolic-ref -q HEAD || true)"
  agent_ensure_pnpm
  # One install at this standalone workspace root. pnpm owns allowed native builds and prepare hooks.
  if ! STANDALONE=true pnpm install --frozen-lockfile --prefer-offline; then
    agent_die "Frozen install failed in $AGENT_REPO_ROOT. Fix the reported dependency/lockfile problem in a separate change; setup never regenerates the lockfile."
  fi
  [[ "$(git rev-parse HEAD)" == "$before_head" ]] || agent_die "HEAD changed during dependency installation"
  [[ "$(git symbolic-ref -q HEAD || true)" == "$before_branch" ]] || agent_die "Branch changed during dependency installation"
}
