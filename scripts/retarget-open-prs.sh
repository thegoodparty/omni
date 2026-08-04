#!/usr/bin/env bash
#
# Retarget every open PR from `develop` to `main`.
#
#   bash scripts/retarget-open-prs.sh [owner/repo]
#
# Idempotent. If you rename develop -> main with GitHub's native branch-rename
# feature, GitHub already retargets open PRs automatically, so this finds nothing
# and exits 0 — making it a useful post-rename verification too. It only does
# real work if you performed a manual (non-rename) cutover; run it BEFORE
# deleting the develop branch in that case.
#
set -euo pipefail

REPO="${1:-thegoodparty/omni}"

mapfile -t prs < <(gh pr list --repo "$REPO" --base develop --state open --json number --jq '.[].number')

if [ "${#prs[@]}" -eq 0 ]; then
  echo "No open PRs target develop. Nothing to retarget."
  exit 0
fi

echo "Retargeting ${#prs[@]} open PR(s) from develop to main in $REPO:"
for n in "${prs[@]}"; do
  echo "  - #$n"
  gh pr edit "$n" --repo "$REPO" --base main
done
echo "Done."
