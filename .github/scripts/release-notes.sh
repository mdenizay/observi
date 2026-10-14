#!/usr/bin/env bash
# Print release notes for a tag, built from the commit messages since the
# previous tag. Usage: .github/scripts/release-notes.sh v0.7.2
set -euo pipefail

tag="${1:?usage: release-notes.sh <tag>}"
repo="${GITHUB_REPOSITORY:-mdenizay/observi}"
prev="$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)"
range="${prev:+$prev..}$tag"

git log --reverse --no-merges --format='%H' "$range" | while read -r sha; do
  subject="$(git log -1 --format=%s "$sha")"
  # $(...) drops trailing newlines; the Co-Authored-By trailer is noise here.
  body="$(git log -1 --format=%b "$sha" | grep -v '^Co-Authored-By:' || true)"
  printf '### %s\n\n' "$subject"
  if [ -n "$body" ]; then
    printf '%s\n\n' "$body"
  fi
done

if [ -n "$prev" ]; then
  printf '**Full Changelog**: https://github.com/%s/compare/%s...%s\n' "$repo" "$prev" "$tag"
fi
