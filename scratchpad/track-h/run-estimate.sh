#!/bin/bash
# Harness: run the extracted estimate step against the real wave-0 CLI.
# $1 = agents, $2 = live
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SCRATCH/bin:$PATH"
RT="$(mktemp -d)"
export RUNNER_TEMP="$RT"
export GITHUB_OUTPUT="$RT/out.txt"; : > "$GITHUB_OUTPUT"
export GITHUB_STEP_SUMMARY="$RT/summary.md"; : > "$GITHUB_STEP_SUMMARY"
export CLI="src/chats/evals/judge/cli.ts"
export AGENTS="$1"
export REQUESTED="$1"
export LIVE="${2:-false}"
export SWEEP_CAPABLE="${3:-true}"
export REQUESTED_BY="stephentanguis"
export CANDIDATE_SHA="0123456789abcdef0123456789abcdef01234567"
export BASE_REF="universal-judge"
echo "########## agents=$1 live=${2:-false} ##########"
bash "$SCRATCH/estimate.sh" > "$RT/log.txt" 2>&1
code=$?
echo "--- step exit: $code"
echo "--- workflow commands / log tail:"
grep -E '^::(error|notice|warning)' "$RT/log.txt" || true
echo "--- GITHUB_OUTPUT:"
cat "$GITHUB_OUTPUT"
echo "--- comment.md (if any):"
[ -f "$RT/comment.md" ] && cat "$RT/comment.md" || echo "(none)"
echo "--- step summary (first 12 lines):"
head -12 "$GITHUB_STEP_SUMMARY"
echo
