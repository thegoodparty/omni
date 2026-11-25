#!/usr/bin/env bash
# Usage: classify.sh [extra-pattern ...]
#
# Reads NUL-separated repo paths on stdin and prints `false` only when every
# one of them is outside app code, otherwise `true`.
#
# Each extra pattern is a further `case` pattern for a path that is outside
# app code for this caller only. gp-webapp.yml uses it to skip on gp-api's
# Pulumi sources, which gp-api's own tests import and the webapp never reads.
# The patterns are matched after the built-in list and cannot override it.
#
# This is the one list of "no app code" paths. Anything not matched below is an
# app change, including paths that do not exist yet, so a new top-level
# directory gets the full run until someone decides otherwise here. An empty
# list is an app change too: "nothing changed" is not something CI should
# believe without proof.
#
# `case` patterns, not globs: `*` matches `/` here, so `docs/*` covers every
# depth, and the order of the arms is the precedence. `*/*` sits above `*.md`
# so that only root-level Markdown is exempt; a nested AGENTS.md is read by
# tests and generators inside its package.
set -euo pipefail

extra=("$@")

# 0 when the path matches one of the caller's extra patterns.
matches_extra() {
  local pattern
  for pattern in ${extra[@]+"${extra[@]}"}; do
    # shellcheck disable=SC2254 # the pattern is meant to expand as a glob
    case "$1" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

seen=0
while IFS= read -r -d '' path || [ -n "$path" ]; do
  seen=1
  case "$path" in
    docs/* | .claude/* | .mcp.json | packages/gp-admin/* | packages/prototypes/*) ;;
    */*)
      if ! matches_extra "$path"; then
        echo true
        exit 0
      fi
      ;;
    *.md) ;;
    *)
      echo true
      exit 0
      ;;
  esac
done

if [ "$seen" -eq 0 ]; then
  echo true
  exit 0
fi
echo false
