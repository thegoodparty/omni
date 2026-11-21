#!/usr/bin/env bash
# Fixture test for judge-cases-only.sh. judge-guard.yml runs it before trusting
# the classifier on a real PR.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/judge-cases-only.sh"
src=packages/gp-api/src
failures=0

expect() {
  local want="$1" author="$2" label="$3" got
  shift 3
  if [ "$#" -eq 0 ]; then
    got="$(printf '' | PR_AUTHOR="$author" bash "$script")"
  else
    got="$(printf '%s\n' "$@" | PR_AUTHOR="$author" bash "$script")"
  fi
  if [ "$got" = "$want" ]; then
    echo "ok   cases_only=$got  $label"
  else
    echo "FAIL cases_only=$got (want $want)  $label"
    failures=$((failures + 1))
  fi
}

expect true 'app/delegate-gp' 'one eval file from the scout' \
  "$src/chats/general/chief-of-staff/chief_of_staff.eval.ts"
expect true 'delegate-gp[bot]' 'two eval files from the scout bot' \
  "$src/chats/general/chief-of-staff/chief_of_staff.eval.ts" \
  "$src/chats/general/campaign-manager/campaign_assistant.eval.ts"
expect false 'someone' 'an eval file from a person' \
  "$src/chats/general/chief-of-staff/chief_of_staff.eval.ts"
expect false '' 'no author'  "$src/meetings/meeting_briefing.eval.ts"
expect false 'app/delegate-gp' 'an eval file and agent code together' \
  "$src/chats/general/chief-of-staff/chief_of_staff.eval.ts" \
  "$src/chats/general/chief-of-staff/prompt.ts"
expect false 'app/delegate-gp' 'agent code alone' \
  "$src/chats/general/chief-of-staff/prompt.ts"
expect false 'app/delegate-gp' 'empty diff'

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all ok"
