#!/usr/bin/env bash
# Usage: changed-paths.sh <merge-sha> <pr-head-sha>
#
# Prints, NUL-separated, every path the pull request's merge commit changes
# relative to the base it was merged onto. Run inside a checkout of that merge
# commit with at least depth 2. Exits non-zero when it cannot vouch for the
# list; the caller treats that as an app change.
#
# Why the merge commit and not the PR files API: the API lists the PR's current
# head, which a later push can move away from the commit this run is testing,
# and it stops at 3000 files. `HEAD^1..HEAD` on the merge commit is pinned to
# exactly what this run builds, with no cap.
set -euo pipefail

merge_sha="${1:-}"
head_sha="${2:-}"
if [ -z "$merge_sha" ] || [ -z "$head_sha" ]; then
  echo "changed-paths: merge and head SHAs are both required" >&2
  exit 2
fi

# On anything but the merge commit, HEAD^1 is just the previous commit and the
# diff would cover one commit of the branch instead of all of it. That would
# read a docs-only last commit on an app branch as "no app code".
actual_head="$(git rev-parse --verify HEAD)"
if [ "$actual_head" != "$merge_sha" ]; then
  echo "changed-paths: checked out $actual_head, expected merge commit $merge_sha" >&2
  exit 3
fi
second_parent="$(git rev-parse --verify --quiet 'HEAD^2' || true)"
if [ "$second_parent" != "$head_sha" ]; then
  echo "changed-paths: HEAD^2 is '${second_parent:-<none>}', expected PR head $head_sha" >&2
  exit 3
fi

# --no-renames: a rename is reported as delete + add, so moving a file out of
# app code (packages/gp-api/x.ts -> docs/x.ts) still lists the app path.
git diff --no-renames --name-only -z 'HEAD^1' HEAD
