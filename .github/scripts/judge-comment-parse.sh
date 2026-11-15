#!/usr/bin/env bash
# Parses a `/judge` PR comment into judge-comment.yml's `parse` job outputs.
# Extracted from that job's own "Parse the command" step (ENG-11594: `/judge
# agree` / `/judge dispute <reason>`) so the self-test beside this file can
# exercise it the same way judge-path-floor.self-test.sh exercises
# judge-path-floor.sh — a parser broken by an edit fails loudly here instead
# of quietly misreading the next real comment.
#
# Runs ONLY after judge-comment.yml's own write-access gate has already
# passed (`steps.perm.outputs.allowed == 'true'`) — this file carries no
# authorization logic of its own, by design: the ruling commands added here
# get the SAME gate `/judge` itself already has, not a weaker one.
#
# Inputs, both environment variables:
#   BODY                 the raw comment body (untrusted — never eval'd,
#                         never interpolated into a command)
#   JUDGE_GUARD_ENABLED   the repository variable of the same name; the kill
#                         switch for `/judge agree` and `/judge dispute`
#                         ONLY. Existing `/judge` forms are unaffected by it
#                         (Acceptance Criteria: every existing command
#                         behaves exactly as before).
#
# Output, on stdout, `key=value` lines meant for `>> "$GITHUB_OUTPUT"`:
#   requested, agents, live        — unchanged shape from before this story
#   ruling_kind, ruling_reason     — '' unless this comment is a ruling
#   comment_path                  — a markdown file to post, when set
#
# A ruling comment is NEVER also a sweep request: `ruling_kind` being
# non-empty means `agents`/`live` are not meaningful, and the two downstream
# jobs (`judge`, the existing sweep job; `rule`, the new one) are gated on
# exactly one of `requested`+`ruling_kind==''` or `ruling_kind!=''` so they
# can never both fire for one comment.
set -euo pipefail

BODY="${BODY:-}"
JUDGE_GUARD_ENABLED="${JUDGE_GUARD_ENABLED:-}"
# The self-test points this at a scratch directory; the real workflow step
# points it at $RUNNER_TEMP. Comment files never collide with the other
# producers in the same job (deny-comment.md, usage-comment.md) because this
# script's are named for what they are, not reused.
OUT_DIR="${OUT_DIR:-.}"

emit_comment() {
  local file="$1" message="$2"
  {
    echo '<!-- universal-judge-plan -->'
    echo '## Universal Judge'
    echo ''
    echo "$message"
  } >"$OUT_DIR/$file"
  echo "comment_path=$OUT_DIR/$file"
}

# Only the first line, and it must start the comment — same as the sweep
# parser: quoting somebody else's `/judge` in a reply must not fire anything.
line="${BODY%%$'\n'*}"
line="${line%$'\r'}"
line="${line//$'\t'/ }"

case "$line" in
  /judge | /judge\ *) ;;
  *)
    echo 'requested=false'
    exit 0
    ;;
esac

rest="${line#/judge}"
rest="$(printf '%s' "$rest" | tr -s '[:space:]' ' ')"
rest="${rest# }"
rest="${rest% }"

# RULING BRANCH, checked before anything below touches `--live` or the agent
# allowlist — "agree" and "dispute" are both syntactically valid-looking
# agent ids (lowercase snake_case), so without this they would fall through
# to the sweep parser and be requested as agents nothing registers under
# those names.
ruling_kind=''
ruling_reason=''
case "$rest" in
  agree)
    ruling_kind=agree
    ;;
  dispute | dispute\ *)
    ruling_kind=dispute
    ruling_reason="${rest#dispute}"
    ruling_reason="${ruling_reason# }"
    ;;
esac

if [ -n "$ruling_kind" ]; then
  if [ "$JUDGE_GUARD_ENABLED" != 'true' ]; then
    echo 'requested=false'
    emit_comment 'ruling-guard-off-comment.md' \
      "**The guard is off — nothing was recorded.** \`JUDGE_GUARD_ENABLED\` is not \`true\`, so \`/judge agree\` and \`/judge dispute\` do nothing yet."
    exit 0
  fi
  if [ "$ruling_kind" = dispute ] && [ -z "$ruling_reason" ]; then
    echo 'requested=false'
    emit_comment 'ruling-reason-required-comment.md' \
      '**Not recorded — a dispute needs a reason.** Usage: `/judge dispute <reason>`. `/judge agree` takes none.'
    exit 0
  fi
  {
    echo 'requested=true'
    echo "ruling_kind=$ruling_kind"
    echo "ruling_reason=$ruling_reason"
    echo 'agents='
    echo 'live=false'
  }
  exit 0
fi

# EVERYTHING BELOW IS UNCHANGED FROM BEFORE THIS STORY — the existing sweep
# commands' own parsing, verbatim (judgeCommentWorkflow.self-test.sh pins
# this).
live=false
while [[ " $rest " == *" --live "* ]]; do
  live=true
  rest="$(printf '%s' " $rest " | sed 's/ --live / /')"
  rest="$(printf '%s' "$rest" | tr -s '[:space:]' ' ')"
  rest="${rest# }"
  rest="${rest% }"
done

agents="${rest:-auto}"
if ! [[ "$agents" =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]] || [ "${#agents}" -gt 256 ]; then
  echo 'requested=false'
  emit_comment 'usage-comment.md' \
    '**That is not a request it can read — nothing will be spent.**

Usage: `/judge [agent-id[,agent-id...]|all|auto] [--live]`

Agent ids are lowercase snake_case. `auto` judges whatever the
branch touched and is the default; `all` is the expensive one.
Without `--live` you get the plan and the price and nothing is
spent.'
  exit 0
fi

{
  echo 'requested=true'
  echo "agents=$agents"
  echo "live=$live"
  echo 'ruling_kind='
  echo 'ruling_reason='
}
