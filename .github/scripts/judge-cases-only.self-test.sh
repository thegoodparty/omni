#!/usr/bin/env bash
# Fixture test for judge-cases-only.sh. judge-guard.yml runs this before
# trusting the classifier on a real PR, the same way it runs
# judge-path-floor.self-test.sh: a classifier broken by an edit fails the run
# instead of quietly skipping every PR's sweep, or none.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/judge-cases-only.sh"
cases='packages/gp-api/src/chats/evals/judge/cases'
failures=0

expect() {
  local want="$1" label="$2" got
  shift 2
  if [ "$#" -eq 0 ]; then
    got="$(printf '' | bash "$script")"
  else
    got="$(printf '%s\n' "$@" | bash "$script")"
  fi
  if [ "$got" = "$want" ]; then
    echo "ok   cases_only=$got  $label"
  else
    echo "FAIL cases_only=$got (want $want)  $label"
    failures=$((failures + 1))
  fi
}

expect true 'one case list' \
  "$cases/campaign_assistant.json"
expect true 'two case lists' \
  "$cases/campaign_assistant.json" \
  "$cases/chief_of_staff.json"
expect false 'a case list and an agent prompt together' \
  "$cases/campaign_assistant.json" \
  packages/gp-api/src/chats/general/campaign-manager/campaignManagerPrompt.ts
expect false 'judge code beside the case-list directory' \
  packages/gp-api/src/chats/evals/judge/cases.ts
expect false 'a sibling directory whose name starts the same way' \
  packages/gp-api/src/chats/evals/judge/cases-archive/old.json
expect false 'an agent prompt alone' \
  packages/gp-api/src/chats/general/chief-of-staff/prompt.ts
expect false 'empty diff'

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all ok"
