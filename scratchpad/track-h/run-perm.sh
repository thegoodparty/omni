#!/bin/bash
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SCRATCH/ghbin:$PATH"
RT="$(mktemp -d)"
export RUNNER_TEMP="$RT"
export GITHUB_OUTPUT="$RT/out.txt"; : > "$GITHUB_OUTPUT"
export GITHUB_STEP_SUMMARY="$RT/sum.md"; : > "$GITHUB_STEP_SUMMARY"
export GH_TOKEN=x GH_REPO=thegoodparty/omni ACTOR=someone
export GH_STUB_PERM="$1" GH_STUB_MODE="$2"
out=$(bash "$SCRATCH/perm.sh" 2>&1); code=$?
printf 'perm=%-8s mode=%-5s exit=%s outputs=[%s]\n' "$1" "${2:-ok}" "$code" "$(tr '\n' ' ' < "$GITHUB_OUTPUT")"
printf '   %s\n' "$(grep -E '^::' <<<"$out" | head -1)"
