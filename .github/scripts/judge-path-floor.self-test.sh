#!/usr/bin/env bash
# Fixture test for judge-path-floor.sh (the Test Plan item in ENG-11590: "A
# path-matching unit test ... asserting the same input diff produces the same
# agent set as judge.yml's existing auto logic, for each of the five
# chat-agent path prefixes"). judge-guard.yml runs this before trusting the
# floor on a real PR, the same way detect-app-changes/self-test.sh guards
# classify.sh: a classifier broken by an edit fails the run instead of
# quietly misclassifying every PR after it.
#
# This also diffs judge-path-floor.sh's chat-agent table against judge.yml's
# own, so the two tables drifting apart (a path added to one and not the
# other) fails here instead of going unnoticed indefinitely.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
floor="$here/judge-path-floor.sh"
judge_yml="$here/../workflows/judge.yml"
failures=0

expect() {
  local want="$1" label="$2" got
  shift 2
  if [ "$#" -eq 0 ]; then
    got="$(printf '' | bash "$floor")"
  else
    got="$(printf '%s\n' "$@" | bash "$floor")"
  fi
  if [ "$got" = "$want" ]; then
    echo "ok   agents=$got  $label"
  else
    echo "FAIL agents=$got (want $want)  $label"
    failures=$((failures + 1))
  fi
}

# The five chat-agent path prefixes, one at a time.
expect chief_of_staff 'chief of staff' \
  packages/gp-api/src/chats/general/chief-of-staff/prompt.ts
expect campaign_assistant 'campaign manager dir maps to campaign_assistant id' \
  packages/gp-api/src/chats/general/campaign-manager/prompt.ts
expect ordinance_flow 'ordinance flow' \
  packages/gp-api/src/chats/general/ordinance-flow/prompt.ts
expect priority_flow 'priority flow' \
  packages/gp-api/src/chats/general/priority-flow/prompt.ts
expect briefing_annotation 'briefing chats' \
  packages/gp-api/src/chats/briefing-chats/prompt.ts

# Background experiments and edge cases.
expect meeting_briefing 'background experiment dir is the agent id' \
  packages/runbooks/experiments/meeting_briefing/manifest.json
expect '' '_schema dir is not an agent' \
  packages/runbooks/experiments/_schema/manifest.json
expect '' 'a reserved selector name is a non-match, not a refusal' \
  packages/runbooks/experiments/auto/manifest.json
expect '' 'a reserved selector name is a non-match, not a refusal (all)' \
  packages/runbooks/experiments/all/manifest.json
expect '' 'no agent or shared path' \
  packages/gp-webapp/app/x.tsx docs/x.md
expect '' 'empty diff'
expect chief_of_staff,campaign_assistant 'two agents in one diff, first-touched order' \
  packages/gp-api/src/chats/general/chief-of-staff/a.ts \
  packages/gp-api/src/chats/general/campaign-manager/b.ts
expect chief_of_staff 'the same agent twice de-dupes' \
  packages/gp-api/src/chats/general/chief-of-staff/a.ts \
  packages/gp-api/src/chats/general/chief-of-staff/b.ts

# Drift check: every `packages/gp-api/src/chats/.../*) add <agent>` arm in
# judge.yml's own table must be exactly the set this file's table matches.
extract_chat_agents() {
  grep -oE 'packages/gp-api/src/chats/[a-zA-Z/_-]+\*\)[[:space:]]+add [a-z_]+' "$1" \
    | sed -E 's#.*add ([a-z_]+)$#\1#' \
    | sort -u
}
judge_ids="$(extract_chat_agents "$judge_yml")"
floor_ids="$(extract_chat_agents "$floor")"
if [ "$judge_ids" = "$floor_ids" ]; then
  echo "ok   judge.yml's chat-agent table matches judge-path-floor.sh's"
else
  echo "FAIL judge.yml's chat-agent table and judge-path-floor.sh's have drifted apart"
  echo "  judge.yml:            $(echo "$judge_ids" | tr '\n' ' ')"
  echo "  judge-path-floor.sh:  $(echo "$floor_ids" | tr '\n' ' ')"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all ok"
