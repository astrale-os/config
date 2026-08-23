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
# Idempotent + fail-fast: PUBLISH_DIRS is a producer-before-consumer order. Each
# package is completed on every target registry before the next package starts.
# A version already on a registry and an "already exists" race are the only
# successful skips. Unknown skip-checks, authentication failures and publishing
# errors stop the release immediately, so a consumer can never overtake a failed
# producer.
#
# Env:
#   PUBLISH_DIRS         space-separated package dirs in producer-first order (required)
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
read -r -a PUBLISH_DIR_ARRAY <<< "$PUBLISH_DIRS"

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }
field() { node -p "(require('./$1/package.json').$2)" 2>/dev/null; }
compact() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-500; }

publish_error() {
  echo "::error title=Publication stopped::$1" >&2
  summary "## ❌ Publication stopped"
  summary ""
  summary "$1"
  return 1
}

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

# npm dist-tag for a version. npm (>=11) REFUSES to publish a prerelease without an
# explicit --tag — it won't silently put a prerelease on `latest`. A release -> latest.
# For a prerelease: PRERELEASE_TAG overrides (e.g. 'latest' to make every prerelease
# the default install); 'auto'/unset derives the channel tag from the identifier
# (0.4.0-alpha.13 -> alpha, 1.0.0-rc.2 -> rc).
npm_tag_for() {
  case "$1" in
    *-*)
      if [ -n "${PRERELEASE_TAG:-}" ] && [ "${PRERELEASE_TAG}" != "auto" ]; then
        printf '%s' "$PRERELEASE_TAG"
      else
        local pre="${1#*-}"; printf '%s' "${pre%%.*}"
      fi ;;
    *) printf 'latest' ;;
  esac
}

# Isolated configs keep publication routing independent from the repository's
# install-time .npmrc. npm is the source of truth for public packages; GitHub
# Packages follows as the required mirror / private-package registry.
GH_NEUTRAL="$RUNNER_TEMP/ghpkg.npmrc"; : > "$GH_NEUTRAL"
printf '@astrale-os:registry=%s\n' "$GH_REG" >> "$GH_NEUTRAL"
[ -n "$GH_PACKAGES_TOKEN" ] && printf '//npm.pkg.github.com/:_authToken=%s\n' "$GH_PACKAGES_TOKEN" >> "$GH_NEUTRAL"

NEUTRAL="$RUNNER_TEMP/npmjs.npmrc"; : > "$NEUTRAL"
printf 'registry=%s\n' "$NPM_REG" >> "$NEUTRAL"
[ -n "$NPM_TOKEN" ] && printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" >> "$NEUTRAL"

# Validate the declared producer-before-consumer order before touching a registry.
SCRIPT_DIR="${PUBLISH_ACTION_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
node "$SCRIPT_DIR/validate-order.mjs" "${PUBLISH_DIR_ARRAY[@]}" || exit 1

# Fail before any publication when a selected package requires GitHub Packages
# but the action was not given its repository token.
for dir in "${PUBLISH_DIR_ARRAY[@]}"; do
  read -r gh _ < <(decide "$dir")
  if [ "$gh" = "true" ] && [ -z "$GH_PACKAGES_TOKEN" ]; then
    name=$(field "$dir" name)
    publish_error "GitHub Packages token is required for $name" || exit 1
  fi
done

npm_published=""; gh_published=""

publish_one() {
  local dir="$1" gh npm name version spec e tarball out pub tag
  read -r gh npm < <(decide "$dir")
  name=$(field "$dir" name); version=$(field "$dir" version); spec="$name@$version"
  tarball=""

  # Public registry first: public consumers resolve Astrale packages from npm.
  if [ "$npm" = "true" ]; then
    exists_on "$spec" "$NPM_REG" "$NEUTRAL"; e=$?
    case "$e" in
      0) echo "npm: skip $spec (already published)" ;;
      1)
        tag=$(npm_tag_for "$version")
        if [ "$DRY_RUN" = "1" ]; then
          echo "npm: WOULD PUBLISH $spec (tag $tag)"
        else
          tarball=$(pack_tarball "$dir") || {
            publish_error "pack failed for $spec"
            return 1
          }
          out=$( cd "$RUNNER_TEMP" && NPM_CONFIG_USERCONFIG="$NEUTRAL" npm publish "$tarball" --access public --tag "$tag" --registry="$NPM_REG" 2>&1 ); pub=$?
          if [ "$pub" = "0" ]; then
            echo "npm: published $spec"
            npm_published="$npm_published $spec"
          elif printf '%s' "$out" | grep -qiE 'cannot publish over|already exists|EPUBLISHCONFLICT|previously published'; then
            echo "npm: $spec already exists (idempotent race skip)"
          else
            printf '%s\n' "$out" >&2
            if printf '%s' "$out" | grep -qiE 'E401|EOTP|ENEEDAUTH|one-time pass|two-factor|Unable to authenticate|must be logged in|Unauthorized|EOIDC|oidc|id-token|trusted publish'; then
              summary "Most likely **Trusted Publishing** is missing for $spec."
              publish_error "npm authentication/OIDC blocked $spec: $(compact "$out")"
            else
              publish_error "npm publish failed for $spec: $(compact "$out")"
            fi
            return 1
          fi
        fi
        ;;
      *)
        publish_error "npm skip-check was inconclusive for $spec"
        return 1
        ;;
    esac
  else
    echo "npm: skip $name (private / GitHub-Packages-only — never npm)"
  fi

  # Complete the package's GitHub target before allowing the next package.
  if [ "$gh" = "true" ]; then
    exists_on "$spec" "$GH_REG" "$GH_NEUTRAL"; e=$?
    case "$e" in
      0) echo "GH: skip $spec (already published)" ;;
      1)
        if [ "$DRY_RUN" = "1" ]; then
          echo "GH: WOULD PUBLISH $spec"
        else
          if [ -z "$tarball" ]; then
            tarball=$(pack_tarball "$dir") || {
              publish_error "pack failed for $spec"
              return 1
            }
          fi
          out=$( cd "$RUNNER_TEMP" && NPM_CONFIG_USERCONFIG="$GH_NEUTRAL" npm publish "$tarball" --access=restricted --tag "$(npm_tag_for "$version")" --registry="$GH_REG" 2>&1 ); pub=$?
          if [ "$pub" = "0" ]; then
            echo "GH: published $spec"
            gh_published="$gh_published $spec"
          elif printf '%s' "$out" | grep -qiE 'already exists|cannot publish over|EPUBLISHCONFLICT|409 Conflict'; then
            echo "GH: $spec already exists (idempotent race skip)"
          else
            printf '%s\n' "$out" >&2
            publish_error "GitHub Packages publish failed for $spec: $(compact "$out")"
            return 1
          fi
        fi
        ;;
      *)
        publish_error "GitHub Packages skip-check was inconclusive for $spec"
        return 1
        ;;
    esac
  else
    echo "GH: skip $name (not a GitHub Packages target)"
  fi
}

for dir in "${PUBLISH_DIR_ARRAY[@]}"; do
  echo "=== publish package: $dir ==="
  publish_one "$dir" || exit 1
done

[ -n "$npm_published" ] && { summary "## Published to npm"; for s in $npm_published; do summary "- \`$s\`"; done; }
[ -n "$gh_published" ] && { summary "## Published to GitHub Packages"; for s in $gh_published; do summary "- \`$s\`"; done; }

echo "=== publish done (strict producer order preserved) ==="
