#!/usr/bin/env bash
#
# sync-all.sh — import / re-sync every repo listed in scripts/repos.manifest.
#
# Usage:
#   bash scripts/sync-all.sh            # sync all repos in the manifest
#   bash scripts/sync-all.sh gp-api     # sync only the named repo(s)
#
# Safe to run repeatedly (e.g. on a cron) right up until cutover: each run only
# pulls in commits merged to the source repos since the last sync.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/scripts/repos.manifest"
ONLY=("$@")

# Refuse to run with a dirty tree (a sync is a series of merge commits).
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash before syncing." >&2
  exit 1
fi

wants() {
  [ "${#ONLY[@]}" -eq 0 ] && return 0
  local n="$1"; for x in "${ONLY[@]}"; do [ "$x" = "$n" ] && return 0; done; return 1
}

while read -r name url branch prefix _rest; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue;; esac
  wants "$name" || continue
  bash "$ROOT/scripts/sync-repo.sh" "$name" "$url" "$branch" "$prefix"
done < "$MANIFEST"

echo "==> sync-all complete."
