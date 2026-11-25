#!/usr/bin/env bash
# Shared source: astrale-os/config. Sync explicitly; never fetch setup code at runtime.
# Source after common.sh. Both the normal setup and the isolated diagnostic use these functions.
set -euo pipefail

agent_browser_missing_libraries() {
  grep -Eq 'error while loading shared libraries|Host system is missing dependencies|Missing libraries:' "$1"
}

agent_browser_use_official_sources() {
  # Codex Cloud: the observed Ubuntu 24.04 image uses snapshot.ubuntu.com, which returns
  # 500/502 through its proxy. Select current Noble archives BEFORE any network attempt.
  # Detect the OS and active APT URIs, not AGENT_HARNESSES (which only selects skills).
  [[ "$1" == ubuntu && "$2" == 24.04 ]] &&
    grep -Eq "^'https?://snapshot[.]ubuntu[.]com/ubuntu/" "$3"
}

agent_browser_write_sources() {
  local directory="$1" architecture="$2" archive security
  case "$architecture" in
    amd64) archive=https://archive.ubuntu.com/ubuntu; security=https://security.ubuntu.com/ubuntu ;;
    arm64) archive=https://ports.ubuntu.com/ubuntu-ports; security="$archive" ;;
    *) printf 'Unsupported Ubuntu architecture: %s\n' "$architecture" >&2; return 1 ;;
  esac
  mkdir -p "$directory/parts" "$directory/lists/partial"
  cat > "$directory/ubuntu.sources" <<SOURCES
Types: deb
URIs: $archive
Suites: noble noble-updates
Components: main restricted universe multiverse
Architectures: $architecture
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
Snapshot: no

Types: deb
URIs: $security
Suites: noble-security
Components: main restricted universe multiverse
Architectures: $architecture
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
Snapshot: no
SOURCES
}

agent_browser_apt_get() {
  local result=0
  local options=(-o Acquire::Retries=1 -o Acquire::http::Timeout=20
    -o Acquire::https::Timeout=20 -o APT::Update::Error-Mode=any
    -o Dpkg::Use-Pty=0 -o APT::Color=0)
  if [[ -n "${AGENT_BROWSER_APT_SOURCES:-}" ]]; then
    options+=(-o "Dir::Etc::sourcelist=$AGENT_BROWSER_APT_SOURCES/ubuntu.sources"
      -o "Dir::Etc::sourceparts=$AGENT_BROWSER_APT_SOURCES/parts"
      -o "Dir::State::lists=$AGENT_BROWSER_APT_SOURCES/lists")
  fi
  if [[ "${1:-}" == update ]]; then
    # Common: bound index refresh, not dpkg. Killing a package installation can leave it half applied.
    timeout --kill-after=5s "${AGENT_BROWSER_APT_UPDATE_TIMEOUT:-90}s" \
      "$AGENT_BROWSER_APT_GET" "${options[@]}" "$@" || result=$?
    if [[ "$result" == 124 || "$result" == 137 ]]; then
      printf '[agent-setup] APT index refresh timeout\n' >&2
    fi
    return "$result"
  fi
  "$AGENT_BROWSER_APT_GET" "${options[@]}" "$@"
}

agent_install_browser_dependencies() (
  # Common: this is called ONLY after a real Chromium launch reports missing system libraries.
  # Healthy Claude Cloud browsers never enter here. Other launch failures must not trigger APT.
  local logs="$1" temporary real_apt source_mode=configured source_directory='' tool
  shift
  local packages=("$@")
  local elevate=()
  [[ "$(uname -s)" == Linux ]] || agent_die 'Automatic browser library repair requires Linux with APT'
  for tool in apt-get timeout dpkg; do
    command -v "$tool" >/dev/null || agent_die "Missing browser repair prerequisite: $tool"
  done
  [[ "${AGENT_BROWSER_APT_UPDATE_TIMEOUT:-90}" =~ ^[1-9][0-9]{0,2}$ ]] ||
    agent_die 'AGENT_BROWSER_APT_UPDATE_TIMEOUT must be 1..999 seconds'
  if [[ "$(id -u)" != 0 ]]; then
    if ! command -v sudo >/dev/null || ! sudo -n true; then
      agent_die 'Installing Chromium system libraries requires root or passwordless sudo'
    fi
    elevate=(sudo -n '--preserve-env=APT_CONFIG,http_proxy,https_proxy,all_proxy,no_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,NO_PROXY')
  fi
  real_apt="$(command -v apt-get)"
  temporary="$(mktemp -d /tmp/astrale-browser-deps.XXXXXX)"
  # APT may create root/_apt-owned files; cleanup must work for passwordless-sudo sessions too.
  trap 'result=$?; "${elevate[@]}" rm -rf "$temporary"; exit "$result"' EXIT
  chmod 755 "$temporary"
  mkdir -p "$logs" "$temporary/bin"
  # --print-uris reads the effective config (including APT_CONFIG) without downloading indexes.
  # Unlike grepping /etc/apt, disabled sources and comments cannot select this policy.
  "${elevate[@]}" "$real_apt" --print-uris update > "$logs/apt-uris.log"
  # shellcheck source=/dev/null
  source /etc/os-release
  if agent_browser_use_official_sources "${ID:-}" "${VERSION_ID:-}" "$logs/apt-uris.log"; then
    source_mode=official
    source_directory="$temporary/apt"
    agent_browser_write_sources "$source_directory" "$(dpkg --print-architecture)"
    cp "$source_directory/ubuntu.sources" "$logs/official.sources"
    # Codex Cloud: override sources/indexes only for this command, without rewriting /etc/apt.
    # Keep the proxy and signature checks. This intentionally uses current Noble packages,
    # not the dated snapshot; no generic upgrade or fallback after auth/signature errors.
    agent_log 'Ubuntu snapshot sources detected (Codex Cloud case): using official archives directly for Chromium libraries'
  fi
  printf '#!/usr/bin/env bash\nexec bash %q --apt-get "$@"\n' "$AGENT_SETUP_DIR/lib/browser.sh" \
    > "$temporary/bin/apt-get"
  chmod +x "$temporary/bin/apt-get"
  agent_log "Installing Chromium system libraries (apt=$source_mode; log: $logs/dependencies.log)"
  # Run Playwright itself as root so its child apt-get retains our bounded wrapper. Existing
  # APT_CONFIG and proxy settings are preserved; Playwright still owns the distro package list.
  local installer=("$(command -v node)" "$(command -v playwright)" install-deps chromium)
  if (( ${#packages[@]} )); then
    installer=(bash -c 'apt-get update && apt-get install --no-install-recommends -y "$@"' setup-gui "${packages[@]}")
  fi
  "${elevate[@]}" env PATH="$temporary/bin:$PATH" \
    AGENT_BROWSER_APT_GET="$real_apt" AGENT_BROWSER_APT_SOURCES="$source_directory" \
    AGENT_BROWSER_APT_UPDATE_TIMEOUT="${AGENT_BROWSER_APT_UPDATE_TIMEOUT:-90}" \
    DEBIAN_FRONTEND=noninteractive \
    "${installer[@]}" 2>&1 | tee "$logs/dependencies.log"
  printf '%s\n' "$source_mode" > "$logs/apt-source"
)

agent_browser_probe() { agent_check_browser playwright 2>&1 | tee "$1"; }

agent_ensure_browser() {
  local logs="${1:-}" started=$SECONDS launch_log
  if [[ -z "$logs" ]]; then
    mkdir -p "$AGENT_SETUP_HOME/logs/browser"
    logs="$(mktemp -d "$AGENT_SETUP_HOME/logs/browser/run.XXXXXX")"
  fi
  mkdir -p "$logs"
  printf 'not-needed\n' > "$logs/apt-source"
  agent_log "Preparing browser; logs: $logs"

  # Claude Cloud: reuse its working Playwright version and matching Chromium (for example
  # PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers). Do not force @latest or replace a healthy pair.
  # Common: apply the same reuse policy on Codex, local machines and cached containers.
  agent_ensure_cli playwright playwright
  if ! agent_playwright_module >/dev/null 2>&1; then
    agent_npm_install "$AGENT_TOOLS" playwright@latest
    agent_link "$AGENT_TOOLS/bin/playwright" playwright
  fi
  agent_select_browser
  launch_log="$logs/launch-before.log"
  if agent_browser_probe "$launch_log"; then
    agent_log "Browser ready after $((SECONDS - started))s"
    return
  fi
  if [[ ! -x "$AGENT_BROWSER_EXECUTABLE_PATH" ]] || ! agent_browser_missing_libraries "$launch_log"; then
    agent_log 'Ensuring full Chromium and the default headless shell are installed'
    # Other workspace packages can use different revisions in the same cache.
    playwright install --no-remove chromium
    launch_log="$logs/launch-install.log"
    if agent_browser_probe "$launch_log"; then
      agent_log "Browser ready after $((SECONDS - started))s"
      return
    fi
  fi
  if ! agent_browser_missing_libraries "$launch_log"; then
    # Force repairs an incomplete download whose Playwright install marker already exists.
    agent_log 'Retrying browser launch after repairing the Chromium download'
    playwright install --force --no-remove chromium
    launch_log="$logs/launch-repair.log"
    if agent_browser_probe "$launch_log"; then
      agent_log 'Browser download repaired; no system installation needed'
      return
    fi
    agent_browser_missing_libraries "$launch_log" ||
      agent_die "Browser launch failed without missing system libraries; see $launch_log"
  fi
  agent_install_browser_dependencies "$logs"
  agent_browser_probe "$logs/launch-after.log"
  agent_log "Browser ready after $((SECONDS - started))s (apt=$(cat "$logs/apt-source"))"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --apt-get) shift; agent_browser_apt_get "$@" ;;
    *) printf 'Source lib/browser.sh after lib/common.sh; it is not a setup entry point.\n' >&2; exit 1 ;;
  esac
fi
