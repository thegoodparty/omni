#!/bin/bash
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
RT="$(mktemp -d)"
export GITHUB_OUTPUT="$RT/out.txt"; : > "$GITHUB_OUTPUT"
export GITHUB_STEP_SUMMARY="$RT/sum.md"; : > "$GITHUB_STEP_SUMMARY"
export BODY="$1"
out=$(bash "$SCRATCH/parse.sh" 2>&1); code=$?
printf 'BODY=%q\n  exit=%s  outputs=[%s]\n' "$1" "$code" "$(tr '\n' ' ' < "$GITHUB_OUTPUT")"
printf '  annotations: %s\n' "$(grep -E '^::' <<<"$out" | tr '\n' ' ')"
[ -s "$GITHUB_STEP_SUMMARY" ] && printf '  summary: %s\n' "$(head -1 "$GITHUB_STEP_SUMMARY")"
