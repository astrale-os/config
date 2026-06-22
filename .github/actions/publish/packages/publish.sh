#!/usr/bin/env bash
# Dual-registry publisher — used by the `publish/packages` composite action, which
# each repo (kernel, sdk, shell) calls from its own publish.yml. Publishes that
# repo's packages to the right registry, idempotently:
#   - GitHub Packages: every @astrale-os/* scoped package (the private set lives ONLY here).
#   - npm:             PUBLIC packages only.
#
# DECISION MATRIX (per package.json) — the single audit point for the critical
# invariant "NEVER publish a private package to npm":
#   private: true                                  -> publish NOWHERE
#   publishConfig.registry contains npm.pkg.github.com (case-insensitive)
#     OR publishConfig.access === "restricted"      -> GitHub Packages ONLY (private)
#   unscoped name (not @astrale-os/*)              -> npm ONLY (GH Packages can't host it)
#   otherwise (scoped, public)                     -> BOTH
#
# AUTH: GitHub Packages uses the repo's own GITHUB_TOKEN (passed as GH_PACKAGES_TOKEN)
# — each repo owns its own packages, so no PAT is needed. npm uses GitHub Actions
# OIDC "Trusted Publishing" (no stored token; needs `id-token: write` + npm >= 11.5.1
# + each package's Trusted Publisher configured to trust its repo). If NPM_TOKEN is
# set it is used instead (local runs / migration).
#
# Idempotent + fault-tolerant: a version already on a registry is skipped; an
# "already exists" race is treated as success; a transient skip-check error does
# NOT blind-publish. Genuine publish errors fail the run; npm auth/OIDC errors are
# reported as a notice (so a healthy GitHub-Packages publish is not lost).
#
# Env:
#   PUBLISH_DIRS         space-separated package dirs (required)
#   GH_PACKAGES_TOKEN    token with packages:write (the repo's GITHUB_TOKEN)
#   NPM_TOKEN            optional npm token; if unset, npm uses OIDC Trusted Publishing
#   GITHUB_STEP_SUMMARY  file to append a human summary to (optional)
#   RUNNER_TEMP          scratch dir (optional; defaults to a mktemp dir)
# Flags:
#   --dry-run            decide + run skip-checks, but never pack/publish
set -u

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

GH_REG="https://npm.pkg.github.com"
NPM_REG="https://registry.npmjs.org"
: "${PUBLISH_DIRS:?set PUBLISH_DIRS}"
: "${RUNNER_TEMP:=$(mktemp -d)}"
GH_PACKAGES_TOKEN="${GH_PACKAGES_TOKEN:-}"
NPM_TOKEN="${NPM_TOKEN:-}"

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }
field() { node -p "(require('./$1/package.json').$2)" 2>/dev/null; }

# Echoes "<gh> <npm>" booleans (true/false) for a package dir.
decide() {
  local dir="$1" name private reg access gh npm
  name=$(node -p "require('./$dir/package.json').name" 2>/dev/null || echo '')
  # NB: String() — `node -p` ANSI-colorizes bare booleans even to a pipe (Node >=24),
  # which would corrupt the comparison and defeat the private guard.
  private=$(node -p "String(require('./$dir/package.json').private === true)" 2>/dev/null || echo false)
  reg=$(node -p "(require('./$dir/package.json').publishConfig?.registry || '').toLowerCase()" 2>/dev/null || echo '')
  access=$(node -p "require('./$dir/package.json').publishConfig?.access || ''" 2>/dev/null || echo '')
  gh=false; npm=false
  if [ "$private" != "true" ]; then
    case "$name" in @astrale-os/*) gh=true ;; esac
    # GUARD: a GitHub-Packages registry OR access:restricted means private -> never npm.
    case "$reg" in
      *npm.pkg.github.com*) npm=false ;;
      *) [ "$access" = "restricted" ] && npm=false || npm=true ;;
    esac
  fi
  printf '%s %s' "$gh" "$npm"
}

# Is $1 (name@version) already on registry $2 (using userconfig $3, "" = default)?
# Returns 0 if present, 1 if genuinely absent (404 / missing version), 2 if
# unknown/transient. NOTE: `npm view name@version version` prints the version on
# its OWN line when present; an E404 error text also CONTAINS the version string,
# so we anchor the match to the start of a line (and trust the exit code) to avoid
# mistaking an error message for a real version.
exists_on() {
  local spec="$1" reg="$2" cfg="${3:-}" out code
  if [ -n "$cfg" ]; then
    out=$( cd "$RUNNER_TEMP" && NPM_CONFIG_USERCONFIG="$cfg" npm view "$spec" version --registry="$reg" 2>&1 ); code=$?
  else
    out=$( npm view "$spec" version --registry="$reg" 2>&1 ); code=$?
  fi
  if [ "$code" = "0" ]; then
    # exit 0 + a version line => present; exit 0 + empty (pkg exists, version
    # missing) => absent, so publish.
    printf '%s\n' "$out" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]' && return 0 || return 1
  fi
  # non-zero: a 404 means genuinely absent; anything else is transient/unknown.
  printf '%s' "$out" | grep -qiE 'E404|404' && return 1
  echo "::warning::skip-check for $spec on $reg was inconclusive (not publishing): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)" >&2
  return 2
}

pack_tarball() {
  local dir="$1" slug pack_dir tb
  slug=$(printf '%s' "$dir" | tr './' '__')
  pack_dir="$RUNNER_TEMP/packs/$slug"; rm -rf "$pack_dir"; mkdir -p "$pack_dir"
  pnpm --dir "$dir" pack --pack-destination "$pack_dir" >&2 || return 1
  tb=$(find "$pack_dir" -maxdepth 1 -name '*.tgz' -print -quit)
  [ -n "$tb" ] || return 1
  printf '%s' "$tb"
}

# ─── GitHub Packages ─────────────────────────────────────────────────────────
gh_rc=0; gh_published=""
if [ -z "$GH_PACKAGES_TOKEN" ]; then
  echo "::warning title=GitHub Packages publish skipped::no packages token (GITHUB_TOKEN) available"
  summary "## ⚠️ GitHub Packages publish skipped — no token"
else
  # Isolated config so GH operations always hit GitHub Packages, regardless of how
  # the repo's own .npmrc routes the @astrale-os scope (sdk/shell route it to npm
  # for install, since their deps are public there — see docs/release.md).
  GH_NEUTRAL="$RUNNER_TEMP/ghpkg.npmrc"; : > "$GH_NEUTRAL"
  printf '@astrale-os:registry=%s\n' "$GH_REG" >> "$GH_NEUTRAL"
  printf '//npm.pkg.github.com/:_authToken=%s\n' "$GH_PACKAGES_TOKEN" >> "$GH_NEUTRAL"
  for dir in $PUBLISH_DIRS; do
    read -r gh _ < <(decide "$dir")
    name=$(field "$dir" name); version=$(field "$dir" version); spec="$name@$version"
    [ "$gh" = "true" ] || { echo "GH: skip $name (not a GitHub Packages target)"; continue; }
    exists_on "$spec" "$GH_REG" "$GH_NEUTRAL"; e=$?
    [ "$e" = "0" ] && { echo "GH: skip $spec (already published)"; continue; }
    [ "$e" = "2" ] && { gh_rc=1; continue; }   # unknown skip-check error -> do not blind-publish
    if [ "$DRY_RUN" = "1" ]; then echo "GH: WOULD PUBLISH $spec"; continue; fi
    tarball=$(pack_tarball "$dir") || { echo "::error::pack failed for $spec"; gh_rc=1; continue; }
    out=$( cd "$RUNNER_TEMP" && NPM_CONFIG_USERCONFIG="$GH_NEUTRAL" npm publish "$tarball" --access=restricted --registry="$GH_REG" 2>&1 ); pub=$?
    if [ "$pub" = "0" ]; then echo "GH: published $spec"; gh_published="$gh_published $spec"
    elif printf '%s' "$out" | grep -qiE 'already exists|cannot publish over|EPUBLISHCONFLICT|409 Conflict'; then
      echo "GH: $spec already exists (idempotent skip)"
    else echo "::error::GitHub Packages publish failed for $spec"; printf '%s\n' "$out"; gh_rc=1; fi
  done
fi

# ─── npm (PUBLIC only) ───────────────────────────────────────────────────────
# Auth = OIDC Trusted Publishing (no token) unless NPM_TOKEN is set.
NEUTRAL="$RUNNER_TEMP/npmjs.npmrc"; : > "$NEUTRAL"
# Neutral config: deliberately NO @astrale-os->GitHub mapping, so scoped public
# packages resolve to npmjs. Used only from $RUNNER_TEMP (no repo .npmrc in scope).
printf 'registry=%s\n' "$NPM_REG" >> "$NEUTRAL"
[ -n "$NPM_TOKEN" ] && printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" >> "$NEUTRAL"

pending=""
for dir in $PUBLISH_DIRS; do
  read -r _ npm < <(decide "$dir")
  name=$(field "$dir" name); version=$(field "$dir" version); spec="$name@$version"
  [ "$npm" = "true" ] || { echo "npm: skip $name (private / GitHub-Packages-only — never npm)"; continue; }
  exists_on "$spec" "$NPM_REG" "$NEUTRAL"; e=$?
  [ "$e" = "0" ] && { echo "npm: skip $spec (already published)"; continue; }
  [ "$e" = "2" ] && { echo "npm: skip $spec (skip-check inconclusive)"; continue; }
  pending="$pending ${dir}|${spec}"
done

npm_rc=0; auth_failed=0
if [ -z "$pending" ]; then
  echo "npm: nothing new to publish"
else
  for item in $pending; do
    dir="${item%%|*}"; spec="${item#*|}"
    if [ "$DRY_RUN" = "1" ]; then echo "npm: WOULD PUBLISH $spec"; continue; fi
    tarball=$(pack_tarball "$dir") || { echo "::error::pack failed for $spec"; npm_rc=1; continue; }
    out=$( cd "$RUNNER_TEMP" && NPM_CONFIG_USERCONFIG="$NEUTRAL" npm publish "$tarball" --access public --registry="$NPM_REG" 2>&1 ); pub=$?
    if [ "$pub" = "0" ]; then echo "npm: published $spec"
    elif printf '%s' "$out" | grep -qiE 'cannot publish over|already exists|EPUBLISHCONFLICT|previously published'; then
      echo "npm: $spec already exists (idempotent skip)"
    elif printf '%s' "$out" | grep -qiE 'E401|EOTP|ENEEDAUTH|one-time pass|two-factor|Unable to authenticate|must be logged in|Unauthorized|EOIDC|oidc|id-token|trusted publish'; then
      echo "::warning::npm auth/OIDC blocked publishing $spec"; auth_failed=1
    else echo "::error::npm publish failed for $spec"; printf '%s\n' "$out"; npm_rc=1; fi
  done
  if [ "$auth_failed" = "1" ]; then
    summary "## ⚠️ npm publish blocked by auth/OIDC"
    summary ""
    summary "Most likely a package is missing its **Trusted Publisher** on npmjs — it must"
    summary "trust this repo + workflow (see docs/release.md). Configure it, or set an"
    summary "\`NPM_TOKEN\` secret, then re-run."
    echo "::warning title=npm auth failed::OIDC/token rejected — configure Trusted Publishing (see docs/release.md)"
  fi
fi

[ -n "$gh_published" ] && { summary "## Published to GitHub Packages"; for s in $gh_published; do summary "- \`$s\`"; done; }

rc=0
[ "$gh_rc" != "0" ] && rc=1
[ "$npm_rc" != "0" ] && rc=1
echo "=== publish done (gh_rc=$gh_rc npm_rc=$npm_rc) ==="
exit $rc
