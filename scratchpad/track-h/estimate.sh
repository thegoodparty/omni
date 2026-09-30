set -euo pipefail

# "Nothing here is judgeable" is a SKIP, not a failure, and it is a
# different thing from "the CLI's output made no sense", which is
# further down and does fail. `/judge briefing_annotation` is the live
# example of the first: it is a real agent, the request is fine, the
# CLI exits 0 — and it is the one registry entry marked blocked, so
# the plan lists nothing. Failing that red would put an X on a PR
# whose author did nothing wrong, which this file's own rule says
# reads as "the judge is broken".
nothing() {
  echo "::notice::nothing to judge: $1"
  echo "sweep_agents=" >> "$GITHUB_OUTPUT"
  { echo '### Universal Judge: nothing to judge'; echo ''; echo "$1"; } \
    >> "$GITHUB_STEP_SUMMARY"
}

# THE CLI'S EXIT CODE IS THE CONTRACT, not its prose. Since #2198 it
# exits 1 when an id is not in the registry and 0 for a request that
# is fine — including one whose only agent is blocked, because
# nothing about that request is wrong. Reading the status rather than
# grepping for `unknown agent ids:` means a reworded line cannot turn
# a typo in a PR comment into a quietly shorter sweep.
#
# Redirected rather than piped through `tee`: with `pipefail` the
# exit status of a pipeline is not straightforwardly the CLI's, and
# this is the one number the step is reading. stderr is left to the
# job log, so the CLI's own error text is visible without being
# spliced into the plan that goes on the PR.
status=0
npx tsx "$CLI" --agents="$AGENTS" --dry-run \
  > "$RUNNER_TEMP/plan.txt" || status=$?
cat "$RUNNER_TEMP/plan.txt"

if [ "$status" -ne 0 ]; then
  echo "::error::the judge CLI rejected this request (exit $status). It names an id that is not in the agent registry, or it could not produce a plan; the plan output and its error are above."
  exit 1
fi

# The CLI's first line is `... plan (N agents)`, and N is the length
# of the very list it would sweep. Cross-checking the priced rows
# against it is the check that catches the real hazard here: pricing
# re-parses a human-readable plan, so a row whose shape the regex
# does not match would be dropped from the total while the sweep
# still ran that agent. Under-reporting a bill is worse than refusing
# to report one.
#
# Not anchored to line one, and the first match taken with a second
# `sed` rather than `head`: `head` would close the pipe on that line
# and, with `pipefail`, leave the writer with EPIPE and fail the step
# for the wrong reason — the trap the gate step above documents. Not
# anchored to line one so that anything a tool puts on stdout ahead
# of the plan does not stop the judge for a reason that has nothing
# to do with the judge. The CLI prints the header once, so taking the
# first match is the same as taking the only one.
planned="$(sed -nE 's/^Universal Judge .*plan \(([0-9]+) agents?\)$/\1/p' \
  "$RUNNER_TEMP/plan.txt" | sed -n '1p')"
if [ -z "$planned" ]; then
  echo "::error::could not find the plan header in the CLI output, so there is no count to check the estimate against; refusing to guess at a cost"
  exit 1
fi

if [ "$planned" -eq 0 ]; then
  nothing "the plan is valid and there is nothing in it to compare. Everything asked for is blocked in the registry — see the plan in the log."
  exit 0
fi

# `  <agentId>  [<shape>]  cases: <value>` — the CLI's own plan rows.
rows="$(sed -nE 's/^  ([a-z0-9_]+)  \[(chat|background)\]  cases: (.*)$/\1 \2 \3/p' \
  "$RUNNER_TEMP/plan.txt")"

parsed=0
if [ -n "$rows" ]; then
  # `tr` because BSD `wc` pads its count with spaces and the number
  # goes into an annotation a person reads.
  parsed="$(printf '%s\n' "$rows" | wc -l | tr -d '[:space:]')"
fi

if [ "$parsed" -ne "$planned" ]; then
  echo "::error::the CLI planned $planned agents and this step could read only $parsed of them out of its output. The pricing regex and the plan format have drifted apart. Fix that rather than trusting a total assembled from part of the plan."
  exit 1
fi

total=0
sweep_agents=""
keep() {
  case ",$sweep_agents," in
    *",$1,"*) ;;
    *) sweep_agents="${sweep_agents:+$sweep_agents,}$1" ;;
  esac
}

# A brace group and a here-string, not a subshell and not a pipe:
# `total` and `sweep_agents` have to survive the loop.
{
  echo '| agent | shape | case list | estimated USD |'
  echo '| --- | --- | --- | --- |'
  while read -r id shape cases; do
    # `NO CASE LIST YET` is what the CLI prints for a registry entry
    # whose `cases` is null — which today is every entry. Such a row
    # is deliberately NOT priced and NOT swept: an agent with no case
    # list has no inputs, so there is nothing to compare, and pricing
    # it at the full per-agent rate would put a number on the PR for
    # work that cannot happen. It is still listed, so the gap is
    # visible rather than silently dropped. This resolves itself as
    # the case lists land.
    case "$cases" in
      ''|NO\ CASE\ LIST\ YET)
        printf '| %s | %s | none yet | not priced |\n' "$id" "$shape"
        continue
        ;;
    esac
    case "$id" in
      ordinance_flow) cents=3500 ;;  # ~5x per step, per the design doc
      *) [ "$shape" = "chat" ] && cents=700 || cents=1300 ;;
    esac
    total=$((total + cents))
    keep "$id"
    # `$id` and `$shape` are held to a shape by the row regex's
    # capture groups; `$cases` is `(.*)`, so it is arbitrary CLI
    # stdout — and this table is `cat`'d into the comment OUTSIDE the
    # fence, where it renders as markdown under the bot's name on a
    # public repository. Same rule as the fenced plan below, plus the
    # table delimiter: an unescaped `|` silently reshapes the row.
    # Wrapped in a code span, which is safe once the backticks are
    # gone.
    safe_cases="$(printf '%s' "$cases" | tr -d '\r`' \
      | sed 's/|/\\|/g' | cut -c1-120)"
    printf '| %s | %s | `%s` | ~%d.%02d |\n' \
      "$id" "$shape" "$safe_cases" "$((cents / 100))" "$((cents % 100))"
  done <<<"$rows"
} > "$RUNNER_TEMP/table.md"

usd="$(printf '%d.%02d' "$((total / 100))" "$((total % 100))")"
{
  echo "usd=$usd"
  echo "sweep_agents=$sweep_agents"
} >> "$GITHUB_OUTPUT"

# `requested_by` is a `workflow_call` input, so the next caller is
# free to pass anything; both shipped callers pass a GitHub login.
# Validated against that shape rather than scrubbed, because a
# newline in it would forge a heading in a comment the bot signs.
credit=""
if [[ "$REQUESTED_BY" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]]; then
  credit="$REQUESTED_BY"
elif [ -n "$REQUESTED_BY" ]; then
  echo "::warning::requested_by is not a GitHub login, so the plan comment credits nobody"
fi

if [ -z "$sweep_agents" ]; then
  verdict="**Nothing to sweep.** Every agent in this plan is still waiting on a case list, so there is nothing to compare and nothing will be spent."
elif [ "$LIVE" = "true" ] && [ "${SWEEP_CAPABLE:-}" != "true" ]; then
  verdict="**Asked for a live sweep, and this branch cannot run one.** The judge CLI here implements the plan only, so the sweep is not started rather than started and failed. Nothing will be spent."
elif [ "$LIVE" = "true" ]; then
  verdict="**This is a live sweep.** It starts now."
else
  verdict="**Plan only — nothing will be spent.** Reply \`/judge --live\` (or \`/judge $AGENTS --live\`) to run it."
fi

# The CLI's stdout goes into a comment this bot authors on a public
# repository and into the job summary, so it is quoted as untrusted
# text even though we wrote the program printing it: registry strings
# flow through it (a `blockedReason` is free-form prose), and a run of
# three backticks anywhere in it would close the fence and let
# everything after it render as markdown, or as HTML, under the bot's
# name. Seven backticks to open and close, every run of three or more
# inside replaced, and the whole thing capped — a plan is a few dozen
# short lines, and a megabyte-long PR comment is a symptom rather than
# something to reproduce faithfully.
quote_plan() {
  head -c 8000 "$RUNNER_TEMP/plan.txt" | tr -d '\r' \
    | sed -E 's/`{3,}/[fence]/g'
  if [ "$(wc -c < "$RUNNER_TEMP/plan.txt")" -gt 8000 ]; then
    echo '[truncated: the full plan is in the run log]'
  fi
}

{
  echo '<!-- universal-judge-plan -->'
  echo '## Universal Judge'
  echo ''
  echo "$verdict"
  echo ''
  echo "| | |"
  echo "| --- | --- |"
  echo "| estimated cost | **~\$$usd** |"
  if [ "$REQUESTED" = "$AGENTS" ]; then
    echo "| agents | \`$AGENTS\` |"
  else
    echo "| agents | \`$AGENTS\` (asked for: \`$REQUESTED\`) |"
  fi
  # The set that will actually be swept, whenever it is narrower
  # than the selection. This table exists to make an accidental
  # `all` visible; a row naming a WIDER list than the run will use is
  # the same failure pointing the other way, and the sweep job's own
  # summary prints the narrow list, so without this "agents" would
  # name two different sets in two summaries of one run.
  if [ "$sweep_agents" != "$AGENTS" ]; then
    echo "| to sweep | \`${sweep_agents:-nothing}\` |"
  fi
  echo "| candidate | \`$CANDIDATE_SHA\` |"
  echo "| base | \`$BASE_REF\` |"
  echo ''
  cat "$RUNNER_TEMP/table.md"
  echo ''
  echo 'Estimates are the design doc'"'"'s measured sweep costs, rounded. They exist'
  echo 'to make an accidental all-agents sweep visible before it is expensive,'
  echo 'not to bill anyone. An agent with no case list yet is listed but'
  echo 'neither priced nor swept, because it has nothing to compare.'
  echo ''
  echo '<details><summary>Plan</summary>'
  echo ''
  echo '```````'
  quote_plan
  echo '```````'
  echo ''
  echo '</details>'
  if [ -n "$credit" ]; then
    echo ''
    echo "Requested by @$credit."
  fi
} > "$RUNNER_TEMP/comment.md"

cat "$RUNNER_TEMP/comment.md" >> "$GITHUB_STEP_SUMMARY"

# Published only now that the file exists, so the step that posts the
# comment can be gated on this one output and nothing else. It is
# also the only place the path is written down: the shell here says
# `$RUNNER_TEMP` and a `${{ runner.temp }}` in the next step's `env`
# would be the same directory spelled a second way, which is one
# rename away from being two different directories.
echo "comment_path=$RUNNER_TEMP/comment.md" >> "$GITHUB_OUTPUT"

if [ -z "$sweep_agents" ]; then
  echo "::notice::nothing to sweep: no agent in this plan has a case list yet, so no sweep will run"
fi
