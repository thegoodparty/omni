set -euo pipefail

# Only the first line, and it must start the comment. Quoting somebody
# else's `/judge` in a reply should not fire a second sweep.
#
# Sliced in the shell rather than piped to `head -n 1`: a comment body
# has no length limit worth relying on, and with `pipefail` set a
# `head` that closes the pipe on line one leaves the writer with
# EPIPE — so a long comment would fail the step instead of being read.
line="${BODY%%$'\n'*}"
line="${line%$'\r'}"
# Tabs to spaces before the dispatch check below, which needs a
# literal space after `/judge`. A pasted comment really can carry
# `/judge<tab>all`, and dropping that would be the one failure mode
# this file otherwise always explains: no notice, no summary, nothing
# in the log. Parameter expansion rather than `tr` to stay in this
# shell.
line="${line//$'\t'/ }"
case "$line" in
  /judge|/judge\ *) ;;
  *) echo "requested=false" >> "$GITHUB_OUTPUT"; exit 0 ;;
esac

rest="${line#/judge}"
rest="$(printf '%s' "$rest" | tr -s '[:space:]' ' ')"
rest="${rest# }"
rest="${rest% }"

# A live sweep is an explicit word, on every path. Bare `/judge`
# answers with the plan and the price and tells you how to confirm it,
# which is one extra comment in exchange for never being surprised by
# an `all` on the invoice.
# Looped, one occurrence at a time, because the matches can overlap:
# `--live --live` shares a separator, so a single `s/ --live / /g`
# pass consumes it and leaves a stray `--live` behind to be rejected
# by the allowlist below. That fails toward not spending, which is
# the right direction, but it answers an unambiguous request with
# "that is not a request it can read".
live=false
while [[ " $rest " == *" --live "* ]]; do
  live=true
  rest="$(printf '%s' " $rest " | sed 's/ --live / /')"
  rest="$(printf '%s' "$rest" | tr -s '[:space:]' ' ')"
  rest="${rest# }"; rest="${rest% }"
done

agents="${rest:-auto}"
# The allowlist, and the reason nothing downstream has to be careful:
# agent ids are lowercase snake_case, plus the literals `all` and
# `auto`. Everything else — a flag, a space, a shell metacharacter, a
# command substitution — is rejected here and never becomes an argument.
#
# A MISS IS NOT AN ERROR. `/judge --all`, or a trailing comma, is a
# typo, and a typo must not put a red X on a PR that is otherwise
# fine: this file's own rule is that a failure someone can do nothing
# about reads as "the judge is broken". So it declines, says what the
# usage is, and exits clean.
#
# The rejected text is deliberately NOT echoed into the annotation.
# `$line` is attacker-controlled on this event, and a workflow
# command is a line-oriented protocol.
# Bounded as well as shaped. A comment body runs to tens of
# kilobytes, and `a,a,a,...` all the way up is a valid selector by
# shape alone; it would become a job output, a reusable-workflow
# input and a command-line argument. It takes write access to get
# here and the CLI would reject the ids anyway, so this is tidiness
# rather than a vector — but the rejection belongs at the gate.
if ! [[ "$agents" =~ ^[a-z0-9_]+(,[a-z0-9_]+)*$ ]] || [ "${#agents}" -gt 256 ]; then
  echo "requested=false" >> "$GITHUB_OUTPUT"
  echo "::notice::not a judge request; the usage is in the run summary"
  {
    echo '### Universal Judge: that is not a request it can read'
    echo ''
    echo 'Usage: `/judge [agent-id[,agent-id...]|all|auto] [--live]`'
    echo ''
    echo 'Agent ids are lowercase snake_case. `auto` judges whatever the'
    echo 'branch touched and is the default; `all` is the expensive one.'
    echo 'Without `--live` you get the plan and the price and nothing is'
    echo 'spent.'
  } >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

{
  echo "requested=true"
  echo "agents=$agents"
  echo "live=$live"
} >> "$GITHUB_OUTPUT"
echo "requested agents=$agents live=$live"
