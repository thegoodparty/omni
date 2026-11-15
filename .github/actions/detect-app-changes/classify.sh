#!/usr/bin/env bash
# Reads NUL-separated repo paths on stdin and prints `false` only when every
# one of them is outside app code, otherwise `true`.
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

seen=0
while IFS= read -r -d '' path || [ -n "$path" ]; do
  seen=1
  case "$path" in
    docs/* | .claude/* | .mcp.json | packages/gp-admin/* | packages/prototypes/*) ;;
    */*)
      echo true
      exit 0
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
