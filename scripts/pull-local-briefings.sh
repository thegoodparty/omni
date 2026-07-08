#!/usr/bin/env bash
# Pull agent-job artifact.json files from S3 into the local briefings gallery dir.
#
# The gallery (packages/gp-webapp app/dev/briefings) reads one <runId>.json per
# briefing from LOCAL_BRIEFINGS_DIR, or the omni repo-root .local-briefings/.
#
# For each run this also pulls the agent-run logs (logs/session.jsonl and
# logs/milestones.jsonl) into <runId>.session.jsonl / <runId>.milestones.jsonl,
# which power the agent-run detail viewer (/dev/runs/<runId>). Missing logs are
# tolerated — the artifact pull is what determines ok/fail.
#
# Usage:
#   scripts/pull-local-briefings.sh --exp meeting_briefing --run-ids ID1,ID2,ID3
#   scripts/pull-local-briefings.sh --rounds path/to/rounds/r0-baseline.json
#   scripts/pull-local-briefings.sh --rounds ROUNDS.json --dir /abs/scratch/briefings
#
# --rounds reads run_ids from `cases.*.run_id` and the S3 prefix from
# `experiment_type` (override with --exp). AWS profile gp-admin, region us-west-2.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${LOCAL_BRIEFINGS_DIR:-$REPO_ROOT/.local-briefings}"
EXP=""
RUN_IDS=""
ROUNDS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --exp) EXP="$2"; shift 2 ;;
    --run-ids) RUN_IDS="$2"; shift 2 ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -n "$ROUNDS" ]]; then
  [[ -z "$EXP" ]] && EXP="$(jq -r '.experiment_type' "$ROUNDS")"
  IDS="$(jq -r '.cases[].run_id' "$ROUNDS")"
elif [[ -n "$RUN_IDS" ]]; then
  IDS="$(echo "$RUN_IDS" | tr ',' '\n')"
else
  echo "Provide --rounds <file> or --run-ids <id,id,...>" >&2
  exit 1
fi

if [[ -z "$EXP" ]]; then
  echo "No experiment type. Pass --exp <slug> (e.g. meeting_briefing)." >&2
  exit 1
fi

mkdir -p "$DIR"
echo "Pulling '$EXP' artifacts into $DIR"

ok=0
fail=0
for id in $IDS; do
  [[ -z "$id" ]] && continue
  src="s3://gp-agent-artifacts-dev/$EXP/$id/artifact.json"
  if aws --profile gp-admin --region us-west-2 s3 cp "$src" "$DIR/$id.json" >/dev/null 2>&1; then
    echo "  ok   $id"
    ok=$((ok + 1))
  else
    echo "  MISS $id ($src)"
    fail=$((fail + 1))
  fi

  logs_src="s3://gp-agent-artifacts-dev/$EXP/$id/logs"
  if aws --profile gp-admin --region us-west-2 s3 cp "$logs_src/session.jsonl" "$DIR/$id.session.jsonl" >/dev/null 2>&1; then
    echo "       + session.jsonl"
  fi
  if aws --profile gp-admin --region us-west-2 s3 cp "$logs_src/milestones.jsonl" "$DIR/$id.milestones.jsonl" >/dev/null 2>&1; then
    echo "       + milestones.jsonl"
  fi
done

echo "Done. $ok pulled, $fail missing. Gallery: http://localhost:4000/dev/briefings"
