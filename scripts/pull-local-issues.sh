#!/usr/bin/env bash
# Pull community-issue agent artifact.json files from S3 into the local issue
# gallery dir.
#
# The gallery (packages/gp-webapp app/dev/issues) reads one <runId>.json per
# issue artifact from LOCAL_ISSUES_DIR, or the omni repo-root .local-issues/.
# Each artifact carries its own `list` (top_community | trending) and
# `organization_slug`, so the filename only needs to be the run id.
#
# Usage:
#   scripts/pull-local-issues.sh --run-ids ID1,ID2,ID3
#   scripts/pull-local-issues.sh --run-ids ID1 --exp trending_issues
#   scripts/pull-local-issues.sh --rounds path/to/rounds/r0-baseline.json
#   scripts/pull-local-issues.sh --latest 10
#   scripts/pull-local-issues.sh --latest 10 --dir /abs/scratch/issues
#
# --run-ids tries both experiment prefixes (top_community_issues, trending_issues)
# unless --exp pins one. --rounds reads run_ids from `cases.*.run_id` and the S3
# prefix from `experiment_type` (override with --exp). --latest N pulls the N most
# recently modified run artifacts from each experiment prefix. AWS profile defaults
# to $AWS_PROFILE or "work", region us-west-2.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${LOCAL_ISSUES_DIR:-$REPO_ROOT/.local-issues}"
PROFILE="${AWS_PROFILE:-work}"
BUCKET="gp-agent-artifacts-dev"
EXPS=(top_community_issues trending_issues)
EXP=""
RUN_IDS=""
ROUNDS=""
LATEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --exp) EXP="$2"; shift 2 ;;
    --run-ids) RUN_IDS="$2"; shift 2 ;;
    --rounds) ROUNDS="$2"; shift 2 ;;
    --latest) LATEST="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$DIR"
ok=0
fail=0

pull_one() {
  local exp="$1" id="$2"
  local src="s3://$BUCKET/$exp/$id/artifact.json"
  local logs_src="s3://$BUCKET/$exp/$id/logs"
  if aws --profile "$PROFILE" --region us-west-2 s3 cp "$src" "$DIR/$id.json" >/dev/null 2>&1; then
    echo "  ok   $id ($exp)"
    if aws --profile "$PROFILE" --region us-west-2 s3 cp "$logs_src/session.jsonl" "$DIR/$id.session.jsonl" >/dev/null 2>&1; then
      echo "       + session.jsonl"
    fi
    if aws --profile "$PROFILE" --region us-west-2 s3 cp "$logs_src/milestones.jsonl" "$DIR/$id.milestones.jsonl" >/dev/null 2>&1; then
      echo "       + milestones.jsonl"
    fi
    ok=$((ok + 1))
    return 0
  fi
  return 1
}

if [[ -n "$LATEST" ]]; then
  echo "Pulling $LATEST latest artifacts per experiment into $DIR"
  for exp in "${EXPS[@]}"; do
    keys="$(aws --profile "$PROFILE" --region us-west-2 s3api list-objects-v2 \
      --bucket "$BUCKET" --prefix "$exp/" \
      --query "reverse(sort_by(Contents,&LastModified))[?ends_with(Key,'artifact.json')].Key" \
      --output text 2>/dev/null | tr '\t' '\n' | head -n "$LATEST" || true)"
    for key in $keys; do
      [[ -z "$key" ]] && continue
      id="$(echo "$key" | awk -F/ '{print $2}')"
      pull_one "$exp" "$id" || { echo "  MISS $id ($exp)"; fail=$((fail + 1)); }
    done
  done
  echo "Done. $ok pulled, $fail missing. Gallery: http://localhost:4000/dev/issues"
  exit 0
fi

if [[ -n "$ROUNDS" ]]; then
  [[ -z "$EXP" ]] && EXP="$(jq -r '.experiment_type' "$ROUNDS")"
  IDS="$(jq -r '.cases[].run_id' "$ROUNDS")"
elif [[ -n "$RUN_IDS" ]]; then
  IDS="$(echo "$RUN_IDS" | tr ',' '\n')"
else
  echo "Provide --run-ids <id,id,...>, --rounds <file>, or --latest <n>" >&2
  exit 1
fi

echo "Pulling issue artifacts into $DIR"
SEARCH_EXPS=("${EXPS[@]}")
[[ -n "$EXP" ]] && SEARCH_EXPS=("$EXP")

for id in $IDS; do
  [[ -z "$id" ]] && continue
  found=false
  for exp in "${SEARCH_EXPS[@]}"; do
    if pull_one "$exp" "$id"; then
      found=true
      break
    fi
  done
  if [[ "$found" == false ]]; then
    echo "  MISS $id (${SEARCH_EXPS[*]})"
    fail=$((fail + 1))
  fi
done

echo "Done. $ok pulled, $fail missing. Gallery: http://localhost:4000/dev/issues"
