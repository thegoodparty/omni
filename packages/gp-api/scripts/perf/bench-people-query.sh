#!/usr/bin/env bash
# People-query latency benchmark — the two heavy voter-query classes.
# Backs up ai-rules/performance-tools.md §5 (EXPLAIN ANALYZE); a people-db
# companion to explain.sh, which it delegates to for execution.
#
# Two cases (SQL in scripts/perf/people-queries/), each run EXPLAIN ANALYZE
# against the people-db Voter table and timed against an initial baseline so
# regressions are visible:
#
#   statewide-phone-count  — filtered COUNT over the full FL partition
#                            (GET /voters/voter-file?countOnly=true,
#                            type=sms/robocall). Full-partition Seq Scan is
#                            EXPECTED. Baseline ~3500ms (the honest count the
#                            removed 10k fence-floor used to hide).
#   rare-name-trigram      — last-name LIKE '%zzq%' name search
#                            (GET /v1/contacts?search=zzq). Must resolve via
#                            the pg_trgm GIN indexes. Baseline sub-second;
#                            a multi-second number means it fell back to a
#                            partition scan (regression).
#
# EXPLAIN ANALYZE *executes* each query, so this hits real people-db load.
# It targets the people-db cluster (Voter table), NOT gp-api's DATABASE_URL.
#
# Requires: a Postgres connection to people-db (psql on PATH or a docker
# container — same resolution as explain.sh) and a resolvable people-db URL.
#
# people-db URL is looked up in this order:
#   1. PEOPLE_DATABASE_URL, if already set in the environment.
#   2. PEOPLE_DATABASE_URL in ./.env (cwd).
#   3. PEOPLE_DATABASE_URL in the superproject / main-worktree .env (so a
#      fresh git worktree without its own .env still resolves it).
#
# Usage:
#   scripts/perf/bench-people-query.sh                     # both cases
#   scripts/perf/bench-people-query.sh statewide-phone-count
#   scripts/perf/bench-people-query.sh rare-name-trigram
#   RUNS=5 scripts/perf/bench-people-query.sh              # 5 runs per case
#   PLAN=1 scripts/perf/bench-people-query.sh              # also print the plan
#
# Env overrides:
#   RUNS       (default 3)   iterations per case; the median is reported.
#   PLAN       (default 0)   set 1 to echo each case's full EXPLAIN plan.
#   ALLOW_PROD (default 0)   guard: refuses to run when the resolved host
#                            looks like prod unless set to 1. NEVER benchmark
#                            prod casually — EXPLAIN ANALYZE executes the query.
#
# Baselines are INITIAL, prod-derived (~3.5s / sub-second); tune them from
# production telemetry. On dev people-db the FL partition may be partial, so
# absolute numbers differ — the harness still catches plan regressions.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXPLAIN="$HERE/explain.sh"
QUERY_DIR="$HERE/people-queries"

RUNS="${RUNS:-3}"
PLAN="${PLAN:-0}"
ALLOW_PROD="${ALLOW_PROD:-0}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,/^set -/p' "$0" | sed 's/^# \{0,1\}//;/^set -/d'
  exit 0
fi

# Case name -> baseline milliseconds (the WARN threshold). Keep in sync with
# the SQL files in people-queries/. A case statement (not an associative
# array) so this runs on macOS's system bash 3.2, matching the other perf
# scripts.
baseline_for() {
  case "$1" in
    statewide-phone-count) echo 3500 ;;
    rare-name-trigram) echo 1000 ;;
    *) echo "" ;;
  esac
}

# --- resolve the people-db URL (mirrors explain.sh's .env fallback) ---
if [[ -z "${PEOPLE_DATABASE_URL:-}" ]]; then
  ENV_SRC=""
  if [[ -f ./.env ]]; then
    ENV_SRC="./.env"
  elif command -v git >/dev/null 2>&1; then
    super_root="$(git rev-parse --show-superproject-working-tree 2>/dev/null || true)"
    if [[ -n "$super_root" && -f "$super_root/.env" ]]; then
      ENV_SRC="$super_root/.env"
    else
      common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
      if [[ -n "$common_dir" && -f "$(dirname "$common_dir")/.env" ]]; then
        ENV_SRC="$(dirname "$common_dir")/.env"
      fi
    fi
  fi
  if [[ -n "$ENV_SRC" ]]; then
    line="$(grep -E '^PEOPLE_DATABASE_URL[[:space:]]*=' "$ENV_SRC" | head -1 || true)"
    if [[ -n "$line" ]]; then
      val="${line#*=}"
      # Trim matching surrounding quotes if present.
      val="${val%\"}"; val="${val#\"}"
      val="${val%\'}"; val="${val#\'}"
      PEOPLE_DATABASE_URL="$val"
      echo "→ Loaded PEOPLE_DATABASE_URL from $ENV_SRC" >&2
    fi
  fi
fi

if [[ -z "${PEOPLE_DATABASE_URL:-}" ]]; then
  echo "✗ PEOPLE_DATABASE_URL is not set, and no .env with it was found." >&2
  echo "  Set it explicitly: PEOPLE_DATABASE_URL=postgres://... $0" >&2
  exit 1
fi

# Prod guard: EXPLAIN ANALYZE executes the query, and the statewide count is
# a multi-second full-partition scan — do not fire it at prod by accident.
if [[ "$PEOPLE_DATABASE_URL" == *prod* && "$ALLOW_PROD" != "1" ]]; then
  echo "✗ Resolved people-db URL looks like PROD. Refusing to run." >&2
  echo "  EXPLAIN ANALYZE executes each query (a full FL-partition scan)." >&2
  echo "  Point PEOPLE_DATABASE_URL at dev, or set ALLOW_PROD=1 to override." >&2
  exit 1
fi

# explain.sh reads DATABASE_URL from the environment first, so hand it the
# people-db URL — that's the whole trick to reusing it for the Voter table.
export DATABASE_URL="$PEOPLE_DATABASE_URL"

run_case() {
  local name="$1"
  local sql_file="$QUERY_DIR/$name.sql"
  local baseline
  baseline="$(baseline_for "$name")"

  if [[ ! -f "$sql_file" ]]; then
    echo "✗ Unknown case '$name' (no $sql_file)" >&2
    return 2
  fi

  echo "── $name ($RUNS run(s), baseline ${baseline}ms) ─────────────────"

  local -a samples=()
  local plan_out=""
  for ((i = 1; i <= RUNS; i++)); do
    plan_out="$("$EXPLAIN" -f "$sql_file" 2>/dev/null || true)"
    # Grab the top-level "Execution Time: <n> ms" line from the TEXT plan.
    local ms
    ms="$(printf '%s\n' "$plan_out" | grep -oiE 'Execution Time: [0-9.]+ ms' | head -1 | grep -oE '[0-9.]+' | head -1 || true)"
    if [[ -z "$ms" ]]; then
      echo "  run $i: could not read Execution Time (connection/plan error)" >&2
      continue
    fi
    printf '  run %d: %s ms\n' "$i" "$ms"
    samples+=("$ms")
  done

  if [[ "$PLAN" == "1" ]]; then
    echo "  --- plan (last run) ---"
    printf '%s\n' "$plan_out" | sed 's/^/  /'
  fi

  if [[ ${#samples[@]} -eq 0 ]]; then
    echo "  RESULT: NO DATA (query never returned a timing)"
    return 1
  fi

  # Median of the collected samples.
  local median
  median="$(printf '%s\n' "${samples[@]}" | sort -n | awk '{a[NR]=$1} END{m=int((NR+1)/2); if(NR%2) print a[m]; else printf "%.3f", (a[m]+a[m+1])/2}')"

  local verdict="PASS"
  if [[ -n "$baseline" ]] && awk "BEGIN{exit !($median > $baseline)}"; then
    verdict="WARN (median ${median}ms > baseline ${baseline}ms)"
  fi
  echo "  median: ${median}ms  →  $verdict"
  echo
}

if [[ $# -gt 0 ]]; then
  run_case "$1"
else
  run_case statewide-phone-count
  run_case rare-name-trigram
fi
