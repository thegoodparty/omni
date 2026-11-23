#!/usr/bin/env bash
# Fixture test for judge-path-floor.sh. judge-guard.yml runs it before trusting
# the floor on a real PR.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
floor="$here/judge-path-floor.sh"
failures=0

src=packages/gp-api/src
export JUDGE_MAIN_EVAL_FILES="$src/chats/general/chief-of-staff/chief_of_staff.eval.ts
$src/chats/general/campaign-manager/campaign_assistant.eval.ts
$src/meetings/meeting_briefing.eval.ts
$src/meetings/meeting_schedule.eval.ts"

expect() {
  local want="$1" label="$2" got
  shift 2
  # shellcheck disable=SC2059
  got="$(printf "$@" | bash "$floor")"
  if [ "$got" = "$want" ]; then
    echo "ok   suites=$got  $label"
  else
    echo "FAIL suites=$got (want $want)  $label"
    failures=$((failures + 1))
  fi
}

expect chief_of_staff 'a file under the eval file directory' \
  'M\t%s\n' "$src/chats/general/chief-of-staff/prompt.ts"
expect campaign_assistant 'a different directory' \
  'M\t%s\n' "$src/chats/general/campaign-manager/prompt.ts"
expect meeting_briefing,meeting_schedule 'a directory shared by two suites' \
  'M\t%s\n' "$src/meetings/meetings.service.ts"
expect chief_of_staff 'the eval file itself' \
  'M\t%s\n' "$src/chats/general/chief-of-staff/chief_of_staff.eval.ts"
expect chief_of_staff,campaign_assistant 'two suites, first-touched order' \
  'M\t%s\nM\t%s\n' "$src/chats/general/chief-of-staff/a.ts" "$src/chats/general/campaign-manager/b.ts"
expect chief_of_staff 'the same suite twice de-dupes' \
  'M\t%s\nM\t%s\n' "$src/chats/general/chief-of-staff/a.ts" "$src/chats/general/chief-of-staff/b.ts"
expect '' 'no suite path' \
  'M\tpackages/gp-webapp/app/x.tsx\nM\tdocs/x.md\n'
expect '' 'empty diff' ''
expect new_suite 'an added eval file reaches its own suite' \
  'A\t%s\n' "$src/newdir/new_suite.eval.ts"
expect renamed_suite 'a renamed eval file reaches the suite under its new name' \
  'R100\t%s\t%s\n' "$src/meetings/meeting_briefing.eval.ts" "$src/other/renamed_suite.eval.ts"
expect '' 'a deleted eval file reaches nothing' \
  'D\t%s\n' "$src/chats/general/chief-of-staff/chief_of_staff.eval.ts"
expect meeting_schedule 'a deleted eval file leaves its sibling reached by a sibling edit' \
  'D\t%s\nM\t%s\n' "$src/meetings/meeting_briefing.eval.ts" "$src/meetings/other.ts"

files="$(printf 'D\t%s\nA\t%s\n' "$src/meetings/meeting_briefing.eval.ts" "$src/x/added.eval.ts" | bash "$floor" --eval-files)"
case "$files" in
  *meeting_briefing*) echo "FAIL eval-files kept a deleted file"; failures=$((failures + 1)) ;;
  *added.eval.ts*) echo "ok   eval-files reflects the diff" ;;
  *) echo "FAIL eval-files missed an added file"; failures=$((failures + 1)) ;;
esac

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all ok"
