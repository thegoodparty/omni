#!/usr/bin/env bash
# coldrun-build-rubric.sh — fair-test loop for books/build-output-quality-rubric.md.
#
# For each experiment, launch a CONTEXT-FREE Claude Code headless session (`claude -p`)
# that builds an output-quality rubric by following the runbook alone, with NO access to
# this repo's existing rubrics or this machine's conversation history. The cold run is both
# how you build a new rubric hands-off AND how you validate the runbook itself: where a
# context-free agent gets stuck is where the runbook is underspecified.
#
# Each run is top-level (a `-p` session can spawn its own reader/judge subagents; a nested
# subagent cannot), writes only into $OUTROOT/<exp>/, and never touches scripts/ or books/.
#
# Required env (caller supplies — values stay out of the script so it's machine-agnostic;
# presence is enforced at startup):
#   CLAUDE_CONFIG_DIR   Claude profile dir (e.g. ~/.claude-work)
#   AWS_PROFILE         AWS profile/creds that can read the artifacts bucket
# Optional env:
#   ENV (default prod)  ARTIFACTS_BUCKET (gp-agent-artifacts)  METADATA_BUCKET (agent-experiment-metadata)
#   SYNTH_N (30)        OUTROOT ($RUNBOOKS_DIR/outputs/rubric-runs)  RUNBOOKS_DIR (auto from this file's location)
# Tools: claude (Claude Code CLI), aws, uv.
#
# Risk surface: children run with --dangerously-skip-permissions (unrestricted fs/shell).
# The prompt forbids reading scripts/.env (secrets), but that is a prompt-level control,
# not a sandbox — run only on a machine/profile where that residual risk is acceptable.
#
# Usage:  CLAUDE_CONFIG_DIR=~/.claude-work AWS_PROFILE=work \
#           scripts/shell/coldrun-build-rubric.sh meeting_schedule meeting_briefing
set -uo pipefail

RUNBOOKS_DIR="${RUNBOOKS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV="${ENV:-prod}"
ARTIFACTS_BUCKET="${ARTIFACTS_BUCKET:-gp-agent-artifacts}"
METADATA_BUCKET="${METADATA_BUCKET:-agent-experiment-metadata}"
SYNTH_N="${SYNTH_N:-30}"
# Persistent, auditable, gitignored. Never /tmp — we must be able to reopen any score later
# and see the exact artifact and the exact judge reasoning behind it.
OUTROOT="${OUTROOT:-$RUNBOOKS_DIR/outputs/rubric-runs}"

# Fail fast if the caller forgot the required env — a missing AWS_PROFILE would
# otherwise silently launch hours-long cold runs against the wrong credential chain.
: "${CLAUDE_CONFIG_DIR:?required}" "${AWS_PROFILE:?required}"

[ $# -ge 1 ] || { echo "usage: $0 <experiment> [experiment...]" >&2; exit 2; }
command -v claude >/dev/null || { echo "claude CLI not found" >&2; exit 3; }

pids=(); exps=(); outs=()
for EXP in "$@"; do
  out="$OUTROOT/$EXP/coldrun-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$out/inputs" "$out/judges"
  PROMPT="You are building an output-quality rubric for the PMF experiment ${EXP}. Follow ${RUNBOOKS_DIR}/books/build-output-quality-rubric.md exactly, start to finish.

FAIR-TEST RULES: work only from that runbook plus ${EXP}'s own artifact data. Do NOT read any prior conversation or session memory. Do NOT read any existing rubric or its validation log anywhere in the repo — specifically NOT experiment-evals/${EXP}/quality_rubric.md or experiment-evals/${EXP}/validation_log.md (a previously-adopted rubric is an answer key), and not any other file matching quality_rubric*.md, *_quality_rubric.md, validation_log*.md, or *_rubric_validation_log.md — not even as a template. Discover ${EXP}'s dimensions from its OWN outputs per Step 2.

Config: ENV=${ENV}, ARTIFACTS_BUCKET=${ARTIFACTS_BUCKET}, METADATA_BUCKET=${METADATA_BUCKET}. ${EXP} has thousands of prod artifacts, so do NOT dispatch or generate runs. Bound the synthesis set to ~${SYNTH_N} artifacts; follow the runbook for held-out batching and the verdict.

Spawn your reader and cold-judge subagents via the Agent tool.

PROVENANCE — keep ALL data so any score can be reopened and proven later. Write everything under ${out}/ and DELETE NOTHING:
- ${out}/inputs/ — every artifact (or bundle) you scored, saved by uuid. Never delete an input after scoring it.
- ${out}/judges/<uuid>.<A|B>.md — the FULL output block of EVERY cold judge for EVERY artifact (gate decision + per-dimension scores + the one-line justifications), not just the totals. This is the audit trail; the totals TSV is a summary of it.
- ${out}/rubric.md (final) and ${out}/rubric.vN.md for each version you cut.
- ${out}/scores.tsv (uuid, batch, judgeA, judgeB) and ${out}/validation_log.md.
- ${out}/verdict.txt — pipe the rubric_verdict.py output here.
Run ${RUNBOOKS_DIR}/scripts/python/rubric_verdict.py on the TSV for the final GO/NO-GO. Do not modify anything under ${RUNBOOKS_DIR}/scripts or ${RUNBOOKS_DIR}/books.

When finished report: (1) the rubric dimensions you landed on, (2) how many tuning iterations and the final held-out spread, (3) the GO/NO-GO verdict, (4) every place the runbook was unclear, ambiguous, or made you guess. HARD PROHIBITION: never read scripts/.env or any file under scripts/ named .env (secrets); this applies to you and to every subagent you spawn."

  ( cd "$RUNBOOKS_DIR" && claude -p "$PROMPT" --dangerously-skip-permissions > "$out/run.log" 2>&1
    rc=$?
    echo "=== EXIT $rc for ${EXP} ===" >> "$out/run.log"
    exit "$rc" ) &
  pids+=("$!"); exps+=("$EXP"); outs+=("$out")
  echo "launched ${EXP} -> ${out} (pid $!)"
done

echo "waiting on ${#pids[@]} cold run(s)..."
failed=0
for i in "${!pids[@]}"; do
  wait "${pids[$i]}" || { echo "FAILED: ${exps[$i]} — see ${outs[$i]}/run.log" >&2; failed=$((failed + 1)); }
done
[ "$failed" -eq 0 ] || { echo "${failed}/${#pids[@]} cold run(s) failed" >&2; exit 1; }
echo "all cold runs complete; results in ${OUTROOT}/<exp>/"
