#!/usr/bin/env bash
# Fixture test for judge-comment-parse.sh — the Test Plan item "existing
# commands... parse and authorize exactly as before" plus the new ruling
# forms. judge-comment.yml runs this before trusting the parser on a real
# comment, the same way judge-guard.yml runs judge-path-floor.self-test.sh
# before trusting the floor: a parser broken by an edit fails the run
# instead of quietly misreading the next `/judge`.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parser="$here/judge-comment-parse.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
failures=0

run() {
  local body="$1" guard="${2:-}"
  BODY="$body" JUDGE_GUARD_ENABLED="$guard" OUT_DIR="$scratch" bash "$parser"
}

expect_line() {
  local want="$1" label="$2" got="$3"
  if printf '%s\n' "$got" | grep -qxF "$want"; then
    echo "ok   $label"
  else
    echo "FAIL $label — wanted line '$want', got:"
    printf '%s\n' "$got" | sed 's/^/       /'
    failures=$((failures + 1))
  fi
}

# --- existing commands, unchanged ------------------------------------------

out="$(run '/judge')"
expect_line 'requested=true' 'bare /judge requests' "$out"
expect_line 'agents=auto' 'bare /judge defaults to auto' "$out"
expect_line 'live=false' 'bare /judge is a plan' "$out"

out="$(run '/judge all --live')"
expect_line 'agents=all' '/judge all --live selects all' "$out"
expect_line 'live=true' '/judge all --live goes live' "$out"

out="$(run '/judge chief_of_staff,campaign_assistant')"
expect_line 'agents=chief_of_staff,campaign_assistant' \
  'a comma-separated agent list survives' "$out"

out="$(run '/judge --all')"
expect_line 'requested=false' '/judge --all is unreadable, not an error' "$out"

out="$(run '/judgement day is coming')"
expect_line 'requested=false' \
  '"/judgement..." is turned away, not treated as /judge' "$out"

out="$(run 'lgtm')"
expect_line 'requested=false' 'a plain comment is not a request' "$out"

# --- the new ruling forms ---------------------------------------------------

out="$(run '/judge agree' true)"
expect_line 'requested=true' '/judge agree requests, when the guard is on' "$out"
expect_line 'ruling_kind=agree' '/judge agree sets ruling_kind=agree' "$out"
expect_line 'ruling_reason=' '/judge agree carries no reason' "$out"

out="$(run '/judge dispute the floor misread this change' true)"
expect_line 'requested=true' '/judge dispute <reason> requests' "$out"
expect_line 'ruling_kind=dispute' '/judge dispute sets ruling_kind=dispute' "$out"
expect_line 'ruling_reason=the floor misread this change' \
  '/judge dispute captures the reason verbatim' "$out"

out="$(run '/judge dispute' true)"
expect_line 'requested=false' \
  '/judge dispute with no reason is rejected' "$out"
if ! printf '%s\n' "$out" | grep -q '^comment_path='; then
  echo 'FAIL /judge dispute with no reason should post an explanatory comment'
  failures=$((failures + 1))
else
  echo 'ok   /judge dispute with no reason posts a comment'
fi

out="$(run '/judge agree' false)"
expect_line 'requested=false' \
  '/judge agree with the guard off is rejected' "$out"
if ! printf '%s\n' "$out" | grep -q '^comment_path='; then
  echo 'FAIL /judge agree with the guard off should post an explanatory comment'
  failures=$((failures + 1))
else
  echo 'ok   /judge agree with the guard off posts a comment'
fi

out="$(run '/judge dispute flaky' '')"
expect_line 'requested=false' \
  '/judge dispute with an unset guard variable is rejected' "$out"

# A ruling never falls back to the sweep parser — if it did, "agree" or
# "dispute" would be requested as an AGENT id, since both are syntactically
# valid snake_case ids the allowlist below would otherwise accept.
out="$(run '/judge agree' true)"
if printf '%s\n' "$out" | grep -qE '^agents=agree$'; then
  echo 'FAIL /judge agree must never be requested as a sweep agent'
  failures=$((failures + 1))
else
  echo 'ok   /judge agree is never read as a sweep agent'
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo 'all ok'
