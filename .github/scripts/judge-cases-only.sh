#!/usr/bin/env bash
# Whether a PR changes nothing but Universal Judge case lists, for
# judge-guard.yml.
#
# Such a PR (the case scout's nightly PR, or its flaky-case removals) leaves
# every agent's code identical on main and on the PR, so a guard sweep would
# compare two copies of the same code and could only report the judge's own
# noise. The guard skips the picker and the sweep for it and posts "No agent
# reached". A PR that changes a case list and agent code together is not
# case-list-only, and is swept as usual.
#
# Reads newline-separated repo paths on stdin (the shape `gh pr diff
# --name-only` prints). Prints `true` when there is at least one path and
# every path is under the case-list directory, `false` otherwise.
set -euo pipefail

cases_dir='packages/gp-api/src/chats/evals/judge/cases/'
seen=false

while IFS= read -r path; do
  [ -n "$path" ] || continue
  seen=true
  case "$path" in
    "$cases_dir"*) ;;
    *)
      echo false
      exit 0
      ;;
  esac
done

echo "$seen"
