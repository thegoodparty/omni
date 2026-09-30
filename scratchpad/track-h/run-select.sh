#!/bin/bash
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SCRATCH/ghbin:$PATH"
RT="$(mktemp -d)"
export GITHUB_OUTPUT="$RT/out.txt"; : > "$GITHUB_OUTPUT"
export GITHUB_STEP_SUMMARY="$RT/sum.md"; : > "$GITHUB_STEP_SUMMARY"
export GH_TOKEN=x GH_REPO=thegoodparty/omni PR_NUMBER=2200 BASE_REF=universal-judge
export REQUESTED="$1" GH_STUB_FILES="$2"
out=$(bash "$SCRATCH/select.sh" 2>&1); code=$?
printf 'requested=%-6s exit=%s outputs=[%s]\n' "$1" "$code" "$(tr '\n' ' ' < "$GITHUB_OUTPUT")"
printf '   log: %s\n' "$(tr '\n' '|' <<<"$out")"
