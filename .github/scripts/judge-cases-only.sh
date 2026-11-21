#!/usr/bin/env bash
# Whether a PR is the case scout's own, for judge-guard.yml.
#
# The case scout's PRs only append cases to `*.eval.ts` files, so a guard run
# would compare the same agent code on both arms. Reads the changed paths on
# stdin (the shape `gh pr diff --name-only` prints) and the PR author in
# PR_AUTHOR. Prints `true` when there is at least one path, every path is a
# `*.eval.ts` file and the author is the scout's bot, `false` otherwise.
set -euo pipefail

case "${PR_AUTHOR:-}" in
  'app/delegate-gp' | 'delegate-gp[bot]') ;;
  *)
    echo false
    exit 0
    ;;
esac

seen=false
while IFS= read -r path; do
  [ -n "$path" ] || continue
  seen=true
  case "$path" in
    *.eval.ts) ;;
    *)
      echo false
      exit 0
      ;;
  esac
done

echo "$seen"
