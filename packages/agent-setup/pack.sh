#!/usr/bin/env bash
# Produce the exact release bytes once; consumers pin the accompanying digest.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
out="${1:?Usage: pack.sh OUTPUT_DIRECTORY}"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
version="$(node -p 'require(process.argv[1]).version' "$root/package.json")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/package"
for entry in run.sh lib profiles setup_runtimes.sh setup_browser_tools.sh setup_skills.sh bootstrap README.md package.json; do
  cp -R "$root/$entry" "$stage/package/"
done
name="astrale-setup-$version.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$out/$name" -C "$stage" package
cd "$out"
if command -v sha256sum >/dev/null 2>&1; then sha256sum "$name" > "$name.sha256"; else shasum -a 256 "$name" > "$name.sha256"; fi
cat "$name.sha256"
