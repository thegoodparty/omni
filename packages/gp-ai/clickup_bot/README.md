# ClickUp Bot

Webhook handler that triggers engineer_agent based on ClickUp task tags.

## Architecture

```
ClickUp (tag added)
    ↓ webhook POST
ALB → Lambda (verify signature, validate task_id/tag, fast-ack 200)
    ↓ lambda:InvokeFunction (async self-invoke; falls back to inline until IAM lands)
Lambda worker invocation (dedup check, trigger, ack comment)
    ↓ ecs:runTask (CLICKUP_TASK_ID, INSTRUCTION, AGENT_MODEL overrides)
Fargate (engineer_agent)
    ↓ based on the instruction
ClickUp comment OR GitHub PR
```

## Tag → Action Mapping

| Tag | Label | Model | Result |
|-----|-------|-------|--------|
| `gpbot-analyze` | analyze | opus | Posts bug analysis as [GP-Bot] comment, and may queue an implementation run — see "Analyze before implement" |
| `gpbot-work` | implement | opus | Creates PR and posts link to ClickUp |

`gpbot-analyze` is the front door. `gpbot-work` is normally applied by an
analysis that concluded there is a fix worth making, though applying it by hand
still works and skips straight to the PR.

## Flow

1. A tag lands on a ClickUp task (e.g., `gpbot-analyze`) — applied by hand, by a
   ClickUp Automation, or by the HubSpot integration as it files the ticket
2. ClickUp sends a `taskTagUpdated` **or** `taskCreated` webhook to Lambda. Both
   are subscribed, and the reason is a race — see "Why both events" below
3. Webhook invocation (ClickUp's critical path — must answer in well under
   ClickUp's webhook response timeout):
   - Verify the signature, validate `task_id`, resolve the tag in `TAG_CONFIG`
   - Self-invoke the same Lambda asynchronously with
     `{"gpbot_async": true, "task_id": ..., "matched_tag": ...}` and return
     `200 {"status": "accepted"}` immediately — zero ClickUp API calls in-path
   - A `taskCreated` delivery with no tag delta cannot be resolved without a
     ClickUp call, so the payload instead carries
     `{"resolve_tag_from_task": true}` and the worker does the lookup. The flag
     is explicit rather than a null `matched_tag` so the worker's fail-loud
     check on an unknown tag keeps working
   - If the self-invoke is unavailable (missing IAM — the initial state until
     the follow-up terraform lands — or any invoke error), fall back to running
     the worker steps inline, exactly the pre-fast-ack behavior
4. Worker invocation (async self-invoke; internal payloads are recognized only
   by a top-level `gpbot_async` key with no ALB envelope keys, which an
   internet request cannot produce — an ALB-wrapped body stays a string inside
   `event["body"]`):
   - Tag resolution (`taskCreated` without a tag delta only): `GET /task/{id}`
     and read the tag off the task itself, preferring `gpbot-analyze` when both
     tags are present. No recognizable tag → skip quietly, which is the common
     case since `taskCreated` fires for every task created in the workspace.
     The fetched task is reused by the scope guard below, so this path costs one
     `GET /task`, not two.
   - Scope guard (`implement` only): `GET /task/{id}` and skip when the task is
     not omni code work. See "Scope guard" below.
   - Dedup check: does the task already have a **recent** `[GP-Bot] Processing
     started` comment **for the same label**? → Skip. Analyze and implement
     dedup independently. See "Dedup semantics" below.
   - Atomic dedup claim: conditional DynamoDB write on `{task_id}#{label}` —
     exactly one concurrent worker wins; losers skip quietly. See "Dedup
     semantics" below.
   - Triggers Fargate, passing `CLICKUP_TASK_ID`, `INSTRUCTION`, `AGENT_MODEL`
     and `AGENT_LABEL` as container-override env vars (the instruction encodes
     the analyze-vs-implement contract; there is no `OUTPUT_ACTION`).
     `AGENT_LABEL` is what the agent gates escalation on — see "Analyze before
     implement" — and is passed as a value so a prompt edit cannot silently
     change whether a run may open a PR
   - Posts the `[GP-Bot] Processing started (...)` comment — which also tells
     the user the re-tag cooldown — only after the Fargate task actually
     launched. In the async worker it is retried once on failure (this comment
     is the dedup marker, and the worker is off ClickUp's timeout budget); the
     inline fallback posts it exactly once, because there ClickUp is still
     waiting on the webhook response.
   - Never lets an exception escape: an unhandled exception in an async
     invocation makes Lambda auto-retry it, which would duplicate the launch.
     Failures log an alarm-matching `ERROR: Async processing failed` line (the
     only fail-loud channel — no caller receives an HTTP error) and attempt a
     failure comment.
5. engineer_agent executes based on action type
6. After an **analyze** run succeeds, the agent parses its own `GPBOT-VERDICT`
   line and, on `fix` only, tags the ticket `gpbot-work` — re-entering at step 2.
   Off by default; see "Analyze before implement"

There is no feature flag and no logging-only mode. A matched tag always attempts the
Fargate trigger. If the trigger fails for any reason (missing `ECS_*` env vars, IAM
denial, ECS error), the Lambda posts a `[GP-Bot] Failed to start processing` comment
on the task and returns HTTP 500.

To retry after a failure (e.g. once the config is fixed): remove and re-add the tag.
Failure comments do not mark the task as processed, so the retry re-triggers.

## The sweep (why webhooks are not enough)

**Subscribing to events does not catch every bug, and no subscription can.**

On 2026-08-17, after `taskCreated` went live, 53 tasks were created workspace-wide.
52 produced a webhook delivery. The one that did not was `DATA-2336` — the only
HubSpot-filed ticket in the set, carrying `gpbot-analyze` from the moment it was
created. It emitted **nothing all day**: no `taskCreated`, no `taskTagUpdated`, no
delivery of any kind reached the Lambda.

| | Tasks created | Delivered | Missed |
|---|---|---|---|
| Created in ClickUp by a human | 52 | 52 | 0 |
| Filed by the HubSpot integration | 1 | 0 | **1** |

That disproves the assumption behind "Why both events" below. When the tag arrives
inside the HubSpot create call, ClickUp emits no event we can subscribe to, so
adding another event type cannot fix it. The fix is to stop relying on being told:

`handle_sweep` runs on a schedule (every 15 minutes, invoked with
`{"gpbot_sweep": true}`), lists tasks tagged `gpbot-analyze` updated in the last
`SWEEP_LOOKBACK_HOURS`, and triggers the ones the bot has never spoken on.

The schedule lives in **`.github/workflows/gpbot-sweep.yml`**, not in Terraform, and
that is a workaround rather than a preference. The deploy role
(`github-actions-pulumi-deploy`) grants `lambda:*` but no `events:` action at all, so
`aws_cloudwatch_event_rule` fails `AccessDenied` and takes the entire
`prod/clickup-bot` apply down with it — including the function code update that
already succeeded, which is how the sweep code first reached production with nothing
to trigger it. Invoking the Lambda directly needs no permission the deploy role
lacks. The trade is that GitHub's cron is best-effort and can run late, which this
job absorbs because it is a backstop with a 24-hour lookback. To move it into
Terraform, add `events:PutRule`, `PutTargets`, `DeleteRule`, `RemoveTargets`,
`DescribeRule`, `ListTargetsByRule` and `TagResource` to
`GitHubActionsPulumiDeployPolicy`; the rule/target/permission trio is described in
`infrastructure/modules/clickup-bot/main.tf`.

### Why the sweep needs its own idempotency

**Do not let the sweep rely on the ordinary dedup layers.** Both of them expire
after ~15 minutes *on purpose* — their job is to absorb retry storms while
leaving a deliberate human re-tag free to re-run hours later (see
`DEFAULT_DEDUP_COMMENT_WINDOW_SECONDS`). A 15-minute schedule against a 24-hour
window would therefore re-analyze every ticket in the window on nearly every
pass: ~96 agent runs per ticket per day, at $1.73–$4.79 each.

So the sweep asks a different question and needs a permanent answer:
`has_any_bot_comment` — *has this bot ever spoken on this ticket?* Unwindowed, so
a ticket analyzed a month ago still counts as handled. The 15-minute layers still
run underneath as the concurrency guard.

The two checks fail in opposite directions, deliberately:

| Check | On an unreadable comment | Why |
|---|---|---|
| `has_processing_started_comment` | does **not** block | A drift must not permanently disable re-tag re-runs; the DynamoDB layer still guards duplicates |
| `sweep_should_skip` | **skips** | Guessing "not yet analyzed" on a schedule turns one ClickUp blip into a recurring charge. The webhook is still the primary path and the next sweep retries in 15 minutes |

This also covers the worst failure this system has had. A webhook ClickUp suspends
stops delivering **silently**, as it did from 2026-07-31 to 2026-08-14 while every
dashboard read healthy. A schedule cannot be unsubscribed, so that outage becomes
"up to 15 minutes late" instead of "off for two weeks".

| Guard | Why |
|---|---|
| `has_any_bot_comment` (permanent) | The load-bearing one. A ticket the bot has ever commented on is never swept again — see above |
| `SWEEP_LOOKBACK_HOURS` (default 24) | ~170 tickets already carry this tag. Without a window the first sweep would re-analyze bugs closed months ago at ~$4 each |
| `SWEEP_MAX_TRIGGERS` (default 5) | Bounds the spend of any single pass. Hitting it logs `ERROR` and defers the rest to the next sweep |
| `include_closed=false` | Closed tickets are settled work |
| Analyze only | `gpbot-work` opens a PR, and the gap does not apply to it — hand-tagging and the escalation's own API tag write both fire `taskTagUpdated` normally (verified on ENG-10890/10891). A sweep for it would be a second, less-scrutinised route to opening PRs |
| Declines don't consume the cap | A window full of already-handled tickets must not starve the one that still needs a run |
| One bad task never ends the pass | The next ticket may be the bug nobody has looked at |

To turn it off, disable the `gpbot reconciliation sweep` workflow — but understand
what that restores: bugs filed by HubSpot with the tag applied at creation will
silently never be analyzed.

## Why both events (`taskTagUpdated` and `taskCreated`)

> **Read the sweep section above first.** `taskCreated` remains worth subscribing
> to — it is the fast path, and it catches created-and-tagged tasks the moment
> they appear rather than up to 15 minutes later. But it is *not* sufficient on
> its own, and the measurement below overstated what it would fix.


Subscribing to `taskTagUpdated` alone loses bugs, and it loses them silently.

The tag that summons this bot is applied by the HubSpot integration as it files
the ticket, and whether it lands **inside** the create call or as a **follow-up
edit** is not deterministic. Measured over the five bugs reported 2026-08-14 to
2026-08-17:

| Ticket | Tag arrived as | `taskTagUpdated` fired? | Analyzed? |
|--------|----------------|------------------------|-----------|
| ENG-10889, ENG-10892, ENG-10893 | separate edit | yes | yes |
| ENG-10890, ENG-10891 | inside the create call | **no** | **no** |

Two of five — a 40% miss rate — sat tagged and un-analyzed until someone
re-tagged them by hand. Nothing looked broken from the outside: the webhook was
`active` with `fail_count: 0`, no delivery was dropped, and no error was logged,
because from ClickUp's side there was simply never an event to send. The tell is
`date_updated` sitting 0–1s after `date_created` (nothing ever edited the task)
while the task plainly carries the tag.

`taskCreated` closes it: a created task is judged on the tags it actually
carries, so the trigger no longer depends on which path ClickUp happens to take.

Two consequences worth knowing:

- **Volume.** `taskCreated` fires for every task created anywhere in the
  workspace, so most deliveries now cost one `GET /task` and skip. Cheap, but it
  is the busiest path in the handler — keep it free of ClickUp writes.
- **Widened secrets exposure.** A `taskCreated` delivery with no tag delta
  cannot be classified without the API key, so it can no longer be filtered
  *before* signature verification. During a Secrets Manager outage those
  deliveries return **200 and are dropped** rather than 500ing, because 500ing
  every created task is what drives ClickUp's consecutive-failure counter into
  suspending the webhook — and a suspended webhook is a silent outage that ran
  from Jul 31 to Aug 14 the last time it happened. A delivery we *know* is
  tagged still 500s so ClickUp redelivers. The outage itself still alarms.

**The lookup is not optional** (confirmed 2026-08-17 against a live delivery).
A real `taskCreated` payload's `history_items` carries only `status` and
`task_creation` entries — there is no `tag` field to read, even on a task created
with tags:

```json
"history_items": [
  {"field": "status",        "after": {"status": "to do", "type": "open"}},
  {"field": "task_creation", "data": {"via": "api"}}
]
```

`find_matched_tag` still runs first because it costs nothing and would catch a
future payload change, but do not remove the `GET /task` fallback on the theory
that the tag might be in the delta. It is not.

## Analyze before implement

Every reported bug gets an **analysis**. Only an analysis that concludes there is
a real, bounded code defect queues an **implementation**.

The reason is measured, not theoretical. The five bugs reported 2026-08-14..17
analyzed out as:

| Ticket | What it actually was |
|--------|----------------------|
| ENG-10892 | Real code bug: stale `did_win=false` fails `isActiveCampaign()` → `NO_ACTIVE_CAMPAIGN` on Pro checkout |
| ENG-10890 | **The same bug as ENG-10892** |
| ENG-10893 | Real code bug: Know Your Opponent silently drops opponents with zero collected sources |
| ENG-10891 | Upstream L2 voter-file gap — nothing to fix in omni |
| ENG-10889 | A feature request, not a bug |

Pointing an implement agent at all five produces two PRs that should never have
been written, plus a duplicate of a third. Two of five reported "bugs" not being
code bugs at all is the normal state of an inbox fed by support tickets, so the
filter has to exist somewhere — and the only thing cheap enough to run on
everything, and informed enough to tell a vendor data gap from a defect, is a
read-only agent with the codebase in front of it.

**How it works.** The analyze prompt requires a final line:

```
GPBOT-VERDICT: fix | no-code-change | needs-human
```

After a successful analyze run, `engineer_agent/agent/escalation.py` parses that
line and, on `fix` only, adds `gpbot-work` to the ticket. That re-enters through
the ordinary webhook path — the same route a human tagging by hand takes — so the
scope guard, both dedup layers, and the PR triage workflow all still apply. The
judgement is the model's; the action is deterministic code, which is where the
guard rails live:

| Guard | Why |
|---|---|
| Only from an `analyze` run (`AGENT_LABEL`) | An implement run cannot queue another implement run |
| Only on `status: success` | A budget-capped or deadline-killed run can leave a confident-looking partial analysis |
| Only on a recognized `fix` verdict | Missing, malformed or unknown → leave the ticket alone |
| Skipped if `gpbot-work` is already present | Re-adding an existing tag emits no webhook anyway |
| Never raises | It runs after the analysis is already posted; failing here would turn a useful run into a task-failure alarm |

The verdict is read from the **last** match in the response, because a model
routinely restates the instructions it was given before answering.

**Ramp switch / kill switch.** `GPBOT_ESCALATE_TO_WORK` on the engineer-agent task
definition (`escalate_analysis_to_work` in `environments/prod/engineer-agent-fargate`).
The module still defaults to **false**, so a new environment stays closed until
someone opts in; prod has been **on since 2026-08-17**.

To stop the bot opening PRs, set it back to `false` and apply. Prefer that over
reverting code: it is one variable, it does not wait on a release train, and the
analyze half keeps working while you decide. While it is off the agent still logs
the verdict it *would* have acted on — grep `escalation disabled` to see the queue
that would have formed.

Turning it on has two hard prerequisites, both now met: `vars.GPBOT_PR_CHANNEL_ID`
must be set (bot PRs otherwise arrive as a bare GitHub review request with no
Slack context), and `secrets.GPBOT_SLACK_BOT_TOKEN` must carry an app that can
actually post to that channel. Slack answers `not_in_channel` unless the app is a
member or holds `chat:write.public`, so the app and the channel are one decision,
not two — see "Slack wiring" below.

The team also needs to know bot PRs are coming, that a bot approval does **not**
merge them, and that closing a weak one is the expected outcome.

## Slack wiring

| Setting | Value | Why |
|---|---|---|
| `vars.GPBOT_PR_CHANNEL_ID` | `C022VR6PRQC` (`#bugs`) | Where the people who triage these bugs already are, and the home of the `@serve-bugs` / `@win-bugs` groups the message mentions |
| `secrets.GPBOT_SLACK_BOT_TOKEN` | `gp_ai_bot` | A member of `#bugs` with `chat:write` |

`@serve-bugs` and `@win-bugs` are two-week on-call rotations holding one person
at a time, so `gpbot-pr-triage.yml` reads the current holder out of the group
with `usergroups.users.list` and requests *that* person's GitHub review — the
rotation is honoured with nothing to hand-maintain but the Slack-email →
GitHub-login map in `.github/gpbot-reviewers.json`.

That call needs **`usergroups:read`**, which the token does not yet carry. Until
a Slack app admin adds the scope and reinstalls the app, the lookup answers
`missing_scope` and every bot PR announces to the group — still the right
person — with no individual review requested. Reinstalling can issue a new bot
token, so plan on updating both `secrets.GPBOT_SLACK_BOT_TOKEN` and
`AI_SECRETS_PROD.SLACK_BOT_TOKEN` when it happens.

It is deliberately **not** `secrets.SLACK_APP_BOT_TOKEN`. That is the analytics
app, which is a member of `#product-analytics` only; pointing it at `#bugs` fails
every post with `not_in_channel`. Both gpbot workflows must carry the same app,
since they post to the same channel.

If you move the channel, check the new one against the app first — a token without
`chat:write.public` can only post where it has been invited:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://slack.com/api/conversations.info?channel=<channel_id>" | jq '.channel.is_member'
```

**Cost.** A ticket that escalates pays for two runs, each capped independently at
`AGENT_MAX_BUDGET_USD` (default $15). Observed analyze runs have cost $1.73–$4.79.
The ceiling per escalated ticket is therefore $30, not $15 — budget for the
two-phase flow, not the single run.

## Driving the PR after it opens

`IMPLEMENT_INSTRUCTION` ends at "Post the PR link to ClickUp when done", and the
run exits there. If CI then failed, nothing happened. PR #1306 was opened
2026-08-18, approved by `delegate-reviewer[bot]`, and sat for two days on a red
`E2E` check because no one was watching. #1318 sat the same way.

`.github/workflows/gpbot-ci-drive.yml` closes that gap. It fires when a CI
workflow completes, waits until every check on a `[GP-Bot]` PR has resolved, and
then acts on whichever of three things is outstanding: a branch that no longer
merges, a red check, or a review finding nobody answered.

**Triage comes before action, and that ordering is the whole design.** Most
bot-PR check failures we have actually observed were infrastructure, not
regressions. #1306's failing `E2E Shard (1)` never ran a test: it hung in
`Install Playwright browsers` (an `apt-get` against azure.archive.ubuntu.com)
for 29 minutes until the job's 30-minute timeout cancelled it, while shards 2-4
passed. PR #1319 hit the identical signature twice consecutively. A mechanism
that reflexively asks a model to "fix CI" would answer all of those by editing
application code to satisfy a failure the diff never caused — strictly worse
than leaving the PR alone.

`clickup_bot/ci_triage.py` holds the judgement, as pure functions over JSON so
it is unit-testable against real captured failures rather than in production:

| Evidence | Class | Action |
|---|---|---|
| The same check is red on `main` | pre-existing | Report it. Never fixed, never re-run — it is not this PR's bug |
| A conclusion that is not a verdict (`cancelled`, `timed_out`, `stale`, `startup_failure`, `action_required`), or a known infra signature in the log | infra | Re-run. **Never** escalates to an agent run |
| Anything else | unknown | Re-run **once** first; only a failure that reproduced buys an agent run |

Re-running an unattributable failure before paying for it is the cheap half of
the trade: a flake clears for free, and a real regression comes back with
evidence that it is deterministic. The taxonomy and the round caps are lifted
from `.claude/skills/ship-pr/SKILL.md` "Phase 3" — this automates a judgement
humans already make here rather than inventing a new one.

### A branch that stops merging

Green checks do not mean mergeable. `main` moves, the branch starts conflicting,
and every signal the drive reads still says the PR is fine: checks passed,
approval standing, no open findings. The only visible difference is a greyed-out
merge button on a PR nobody is watching. Nothing reported that.

So a conflicted branch is work too, and it is settled **before** checks and
findings. A conflicted PR cannot land however green it is, so re-running its
checks or answering its threads first spends CI minutes and model tokens to
arrive at a PR that still cannot merge — and the merge that resolves the
conflict re-runs the checks anyway.

There is no cheap first move here, unlike a red check. A re-run is worth trying
on a flake because it clears for free; "conflicting" is already git's answer to
having tried. So the first move is the expensive one, drawn from the same fix-run
budget.

**Only an explicit `CONFLICTING` counts**, and this default runs opposite to the
findings one. GitHub computes mergeability lazily and reports `UNKNOWN` until it
has — asking is what triggers the computation, so the workflow asks up to three
times before giving up and passing `UNKNOWN` through. Reading `UNKNOWN` as
conflicted would point an agent at a branch that merges perfectly well: a wasted
run and a pointless merge commit on a PR a human was about to merge. Erring the
other way costs 30 minutes, and a real conflict does not clear on its own.

**Being merely `BEHIND` `main` is not driven.** The `main` ruleset sets
`strict_required_status_checks_policy` false, so an out-of-date branch still
merges; updating one on every push to `main` would spend a full CI cycle per bot
PR per merge to change nothing about whether it can land.

There is no separate attempt ledger, unlike findings. A finding can stay open
forever after a run that declined to act on it, so its ids have to be banked. A
conflict cannot: a run that resolves it makes it disappear, and one that does not
leaves the same conflict for the shared budget to bound.

### Unanswered review findings

The other half of what #1306 exposed. Cursor Bugbot posted a **correct**
high-severity finding on it three minutes after the PR opened —
`groupByOpponent` seeded roster opponents regardless of `collectionStatus`, and
the page gates its "Collection failed / Try again" card on an empty
`opponents[]`, so a failed collection lost its only retry path.
`delegate-reviewer` approved two minutes later without accounting for it, a
human approved two days after that, and nobody ever answered the thread. The PR
merged, the regression reached `main`, and it was fixed separately in #1431.

Nothing in the system treated that as work. Bugbot posts a `COMMENTED` review
rather than `CHANGES_REQUESTED`, so it never blocks; one approval satisfies the
ruleset; and the drive stopped as soon as the board was green.

So once CI is green, an unresolved Bugbot thread buys a fix run of its own. Four
things take a thread out of scope, and every default errs toward "still needs an
answer", because silently dropping a real finding is the bug this exists to fix:

| Out of scope | Why |
|---|---|
| Resolved | Someone dealt with it |
| Outdated | The lines it points at have changed. This is the natural stop after a fix push: GitHub marks the thread outdated by itself |
| A human has replied | A person owns the thread and the bot must not talk over them. Nobody had replied on #1306, which is why it qualified |
| Raised by `delegate-reviewer` | It withholds approval until its blockers are fixed, which already gates the merge, and it runs a `delegate review` reply protocol a second automated actor would fight |

**A finding gets one fix run and never a second.** The state comment banks the
thread ids a run was pointed at, so a finding still open afterwards goes to a
human. Without that the loop is unbounded in the expensive direction: the agent
disagrees with a false positive, leaves the thread open, and every later pass
reads it as fresh work.

**Checks are settled before findings**, because a run that answers a finding
pushes code that has to pass CI anyway.

There is no severity filter, and that is affordable rather than careless: one
run answers every open thread at once, so cost does not grow with how much
Bugbot found. Parsing a severity string out of a comment body to decide what to
ignore would fail in the direction that just cost us a production regression.

### Caps, and where they live

| Cap | Value | Why |
|---|---|---|
| Re-runs | 3 | Costs CI minutes and no model spend, so the number is set by observation rather than price: #1319 hit the same apt-get hang **twice in a row**, so 1 or 2 would have escalated a pure flake to a human |
| Fix runs | 2 | Matches ship-pr Phase 3's "stop after 2 check-fix rounds". At $1.50-$5 a run this holds the feature to ~$10 per PR, on top of the ~$30 an escalated ticket may already have spent |

The fix-run budget is **shared** between conflicts, failing checks and review
findings, because what it bounds is money rather than any one activity. A PR
that keeps colliding with `main` after spending it is one a human should look
at, not one to keep paying to rebase.

Both are **per-PR and cumulative for the life of the PR**, deliberately not
per-commit. A fix run pushes a commit, and resetting on a new commit would let a
fix run that failed re-trigger itself forever — the money-burning loop the caps
exist to prevent.

They survive across invocations in an upserted PR comment carrying
`<!-- gpbot-ci-state: {...} -->` (the same device as delegate's
`delegate-finding-id` markers). The workflow **writes the new counters before it
takes the action**: a crash between the two costs the PR one attempt, where the
reverse order would let a crash-looping drive spend the same round forever. An
unreadable or hand-edited marker counts as exhausted, not fresh.

The same comment records **when** a fix run was launched, because launching one
changes nothing observable: no check goes pending until the agent actually
pushes, so the 30-minute schedule would otherwise return to an identical red
board, read it as "nothing has happened", and put a second agent on the same
branch. Until an hour has passed — the agent's own 45-minute deadline plus room
to start — the drive waits instead of acting. The Lambda's dedup claim does not
cover this on its own: its TTL is 15 minutes, shorter than the run it guards.

On exhaustion the drive stops and announces in `#bugs` through the same
`vars.GPBOT_PR_CHANNEL_ID` / `secrets.GPBOT_SLACK_BOT_TOKEN` path as the other
two gpbot workflows. Nothing the bot does clears an escalation; a human deletes
the marker comment to hand it back.

### Why `workflow_run` and not `check_suite`

`check_suite` cannot work here at all. GitHub does not deliver it "if the check
suite was created by GitHub Actions", and every check on an omni PR is created
by GitHub Actions, so the workflow would simply never fire. `workflow_run` has
no such restriction and additionally carries secrets and a write token, which
the Slack post and the Lambda invoke both need.

Neither could be replaced by making the agent run poll: `E2E` waits on a full
gp-api preview deploy before its suite starts and routinely takes ~45 minutes,
which is the agent's entire `DEFAULT_DEADLINE_SECONDS`. Polling would spend the
whole run idling on Fargate with nothing left for the fix.

A 30-minute `schedule` backs the event up, for the same reason the
reconciliation sweep exists: subscribing does not catch everything. It covers
three known gaps — GitHub suppresses events for actions taken with
`GITHUB_TOKEN`, so a re-run this workflow requests may not emit `workflow_run`
when it finishes; the concurrency group keeps only one queued run per group; and
a workflow added later is not in the watched list.

### The fix run

A fix run is launched through this Lambda (`{"gpbot_ci_fix": true, ...}` →
`handle_ci_fix`), not by a second path wired straight to ECS, so it reuses the
one audited route to Fargate. `mode` picks the instruction:

| `mode` | Label | Instruction |
|---|---|---|
| `checks` (the default when absent) | `ci-fix` | `CI_FIX_INSTRUCTION` |
| `findings` | `findings-fix` | `FINDINGS_FIX_INSTRUCTION` |
| `conflicts` | `conflicts-fix` | `CONFLICTS_FIX_INSTRUCTION` |

An unrecognised mode is a 400, not a default — quietly running the CI
instruction against a request that asked for something else points an agent at
work nobody asked for. Neither label is `analyze`, which keeps both out of the
analyze→implement escalation, and none is in `TAG_CONFIG`: a ClickUp tag must
never be able to launch a run that pushes to an arbitrary PR. The dedup claim is
keyed on `ci-fix` for **every** mode, because they all push to the same branch
and a claim keyed per-mode could not see that collision.

**Only the PR number, the ClickUp task id and that fixed enum cross the
boundary** — an integer, a character-class-checked id, and one of three literals.
Check names, step names, log text and review-comment bodies are all left out on
purpose. The first three originate in CI output; the last is written by another
model, in a thread anyone who can comment on the repo may add to. Interpolating
any of them into a system prompt would make every failing build and every review
comment a prompt-injection surface. The agent holds `gh` and fetches its own
evidence.

All three instructions forbid, in order of how much damage they do: weakening a
test to make it pass (deleting, skipping, loosening an assertion, or adding a
retry to hide a real failure), merging, opening a second PR, and working outside
the thing they were sent for.

`CI_FIX_INSTRUCTION` additionally tells the agent to check `main` and change
nothing if the failure is infra or pre-existing — a second line of the same
defence, because the signature list in `ci_triage.py` is not exhaustive.

`FINDINGS_FIX_INSTRUCTION` **repeats the scope rules above**, and that
duplication is load-bearing rather than sloppy: the run is pointed at the PR,
not at one thread, so a run bought by one finding would otherwise go on to
answer and resolve a thread a human is mid-conversation in. Resolving hides the
discussion, which is the exact harm the triage filter exists to prevent.

It treats a finding as a claim rather than a verdict:
accept it and fix the cause with a test, reject it and say why in the thread, or
say it could not be judged. Whichever it does, it replies and then resolves the
thread — and it must **never resolve a thread it has not answered**, because
resolving is the record that a finding was dealt with. An unanswered thread left
open is a fine outcome; it goes to a human.

`CONFLICTS_FIX_INSTRUCTION` says **merge `main`, never rebase**, because a
rebase needs a force-push, and force-pushing a reviewed branch marks every
review thread on it outdated — silently clearing the findings the section above
exists to answer. Its real subject is the resolution itself: both sides of a
conflict are somebody's intended change, and taking one side wholesale deletes
work already on `main` while CI stays green, because nothing tests for the
change that was dropped. So `--ours`/`--theirs` on a whole file is called out as
almost never right, and a collision the agent cannot judge is a `git merge
--abort` and a comment rather than a guess.

**Nothing in this feature merges anything.** `gpbot-ci-drive.yml` carries the
same header contract as `gpbot-pr-triage.yml`: the bot getting CI green is not
the bot deciding what lands.

## Scope guard

`gpbot-work` used to be applied by hand, one ticket at a time, so a human
decided "is this omni code work?" before the agent ever ran. ClickUp Automations
now apply it — including one that is workspace-wide on `production-bug` — so
nothing upstream answers that question and this guard is the only thing that
does.

Applies to the **implement label only**. `gpbot-analyze` is deliberately
unrestricted: analyzing a data bug is useful and it is used on DATA tickets
constantly. Only opening a code PR against one is wrong.

An implement trigger is skipped (200, `{"skipped": "out of scope"}`) when any of:

| Signal | Value | Why |
|---|---|---|
| `custom_id` prefix | `DATA-` | Voter-file/district work, not an omni code change |
| `list.id` | `901326391561` (Data Backlog) | Catches DATA-list tasks with no custom ID |
| `list.id` | `901326170992` (Growth-Bugs) | Marketing-site work; does not live in omni |
| tag | `bug: district-assignment` | The data team's marker, for data work sitting in an ENG list |

Two orderings are load-bearing. The guard runs **before the comments GET**, so a
rejected task costs one ClickUp call rather than two — it now fires on every
data ticket in the workspace. And it runs **before the dedup claim**, because a
claim written for a task we then refuse would outlive the delivery and suppress
a legitimate re-tag for the whole TTL.

If the lookup itself fails the guard **fails open** and the run proceeds, with
an alarm-matching log line. One wasted run costs a few dollars and a closeable
PR; refusing every bug during a ClickUp blip is a silent outage.

## Dedup semantics

Only the `[GP-Bot] Processing started` success marker **for the same label**
counts as processed (mirroring the atomic layer's `{task_id}#{label}` key: a fresh
analyze marker never suppresses a gpbot-work trigger), and only while it is recent: within `DEDUP_COMMENT_WINDOW_SECONDS` (default 900) of the
comment's `date`. The marker exists to absorb webhook retry storms and double-tags,
which play out over seconds to minutes. A human re-tagging a task hours later is a
deliberate re-run and must not be silently ignored — dedup had never actually fired
before the 2026-07-14 fix (see below), so "re-tag always re-runs" is the behavior
users already know; an unbounded marker would have silently changed it. Markers with
a missing or unparseable `date` do NOT block — blocking would have no age bound,
so a ClickUp date-format drift would permanently disable re-tag re-runs — and log an
alarm-matching `ERROR` line, because that shape drift is an integration break an
operator must see; the duplicate risk it fails toward is bounded by the atomic
DynamoDB layer. `[GP-Bot] Failed to start processing`
comments never block a retry, regardless of age.

Comment-based dedup is best-effort: two deliveries processed close enough together
both see "no marker yet" and both launch (the check and the comment post are not
atomic). Because it is best-effort, a comments GET failure in the async worker does
not drop the delivery: with `DEDUP_TABLE_NAME` configured the worker proceeds (the
atomic claim still guards duplicates); without it the worker stops and posts the
standard failure comment so the tagger has a visible remove-and-re-add retry path.
The synchronous path instead returns 500 and lets ClickUp redeliver. The authoritative layer is an **atomic DynamoDB claim**: after the comment
check passes, the worker does a conditional `PutItem` on `{task_id}#{label}` into
`DEDUP_TABLE_NAME` — DynamoDB serializes conditional writes, so exactly one worker
wins even under fully concurrent deliveries; losers skip quietly with a 200. Claim
details:

- The claim carries an `expires_at` of now + `DEDUP_TTL_SECONDS` (default 900,
  matching the comment window: same product contract, retry storms are absorbed and
  a deliberate re-tag ~15 minutes later re-runs). DynamoDB TTL garbage-collects old
  claims, and because TTL deletion can lag hours, the conditional write also treats
  an expired-but-not-yet-deleted claim as free.
- A failed launch releases its claim (`DeleteItem`), so the remove-and-re-add-the-tag
  retry contract survives launch failures. A successful launch keeps its claim until
  the TTL expires.
- If `DEDUP_TABLE_NAME` is unset (the state between a code deploy and the terraform
  apply that creates the table), the claim step is a quiet no-op and only
  comment-based dedup applies.
- If the table is broken (throttled, deleted, IAM stripped), the handler **fails
  open** — the launch still happens — and logs an alarm-matching
  `ERROR: dedup table unavailable` line: a duplicate agent costs a few dollars, a
  bot that cannot launch at all is an outage, but an operator must see the breakage.

### Stranded dedup claims

**Symptom:** re-tagging a task does nothing (no ack comment, no Fargate launch, no
failure comment) and the handler-errors alarm fired earlier — e.g. a worker hard
timeout (`Task timed out`) or a `Failed to release dedup lock` line. A claim was
written but the launch behind it died (or a delayed PutItem landed after the
release `DeleteItem` — an accepted race, see `release_dedup_lock` in the handler),
so the claim now suppresses every re-tag until its TTL expires.

**Check:** scan the table for the task's claim:

```bash
aws dynamodb scan --table-name clickup-bot-dedup-prod \
  --filter-expression "contains(pk, :t)" \
  --expression-attribute-values '{":t": {"S": "<task_id>"}}'
```

**Fix:** delete the stranded claim (key is `pk = "{task_id}#{label}"`, label is
`analyze` or `implement`), then re-tag:

```bash
aws dynamodb delete-item --table-name clickup-bot-dedup-prod \
  --key '{"pk": {"S": "<task_id>#<label>"}}'
```

Or just wait: the claim's `expires_at` bounds the suppression at
`DEDUP_TTL_SECONDS` (15 minutes by default) — after that a re-tag reclaims it.

### 2026-07-14 incident

ClickUp delivered ONE `taskTagUpdated` event (gpbot-analyze) six times — the
original plus five timeout retries — and all six launched a Fargate opus agent.
Two bugs compounded. First, every invocation ran 7.6–20.5s of serial synchronous
ClickUp API calls in the webhook path during a ClickUp slowdown, exceeding
ClickUp's webhook response timeout, so ClickUp kept retrying (and counted every
timeout toward the ~100 consecutive failures after which it auto-disables the
webhook — slow responses are an outage risk, not just a duplication risk; the
fast-ack flow above is the fix). Second, the dedup matcher required a
`"type": "text"` key on comment items that the real
`GET /task/{id}/comment` response does not have — verified live, it matched 0 of
13 real comments, including six of the bot's own ack comments — so dedup had
never fired since the feature shipped. The old test fixture had invented the
`type` field (oracle problem); fixtures now use the live-captured shape.

## Monitoring

Handled 500s and 401s do not fire the Lambda `Errors` metric, so terraform
(`infrastructure/modules/clickup-bot/`) creates a CloudWatch log metric filter on the
handler's `ERROR` / `Failed to` log lines (plus the runtime-emitted
`Task timed out`, so a hard-timed-out async worker — which no caller observes and
which Lambda never retries — still alarms), an alarm on that metric, and a
`clickup-bot-failures-prod` SNS topic wired to the shared Slack notifier. The alarm
covers those log lines — not literally every failure path. The
operationally significant failures each emit one and alarm within ~5 minutes: the
fail-loud 500s (missing `ECS_*` config, `ecs:RunTask` failure, comment-fetch failure,
secrets outage), the failure-comment and ack-comment posts the handler deliberately
swallows (ClickUp API down or a rotated `CLICKUP_API_KEY`), signature-verification
401s on gpbot-tagged deliveries (rotated or mismatched `CLICKUP_WEBHOOK_SECRET`), which
would otherwise silently end in ClickUp suspending the webhook, and any failure inside
the async worker invocation (`ERROR: Async processing failed`), whose caller is Lambda's
async plumbing rather than ClickUp, so the alarm is its only fail-loud channel. The
expected fast-ack fallback while self-invoke IAM is absent logs a deliberately quiet
`Async self-invoke unavailable, processing synchronously` line and does NOT alarm.
The deliberately quiet
400s do NOT alarm: a missing `task_id`, malformed JSON, and non-object JSON all log
without `ERROR` / `Failed to` on purpose, so a client cannot fire the alarm through the
public endpoint by echoing those terms in a request.

The filter pattern and the handler's log wording are a two-sided contract: the
handler must emit `ERROR` / `Failed to` on every failure path, and must never echo
unauthenticated request content to the logs (the endpoint is public — an echoed body
containing "ERROR" would let anyone fire the alarm). Both sides are locked by
`clickup_bot/tests/test_handler.py`; reword log lines and the terraform pattern
together.

**Silence is the failure the error alarm cannot see.** Every alarm above needs the
handler to RUN. A webhook that stops delivering produces no logs, no errors, and
no alarm — the bot looks healthy because it looks like nothing happened.

That is not hypothetical. Deliveries stopped on **2026-07-31** and nothing
noticed for 12 days: zero requests to the ALB target group, zero invocations,
zero errors before or after. The `CLICKUP_API_KEY` in `AI_SECRETS_PROD` was a
**personal token belonging to someone who is no longer a workspace member** — it
still authenticates (`GET /user` returns their account) but has lost all
workspace access, so `GET /team` and every task read 404. A webhook registered
with that token dies with it.

Two consequences worth internalizing: **prefer a service account over a personal
token**, and treat the `clickup-bot-no-deliveries-prod` alarm (4 consecutive days
with no invocations, `treat_missing_data = "breaching"` because Lambda metrics
are sparse) as the only thing that will tell you the bot has gone quiet.

### After an outage: check webhook health

During a Secrets Manager outage the Lambda cannot verify signatures for gpbot-tagged
deliveries and returns 500 for them (irrelevant deliveries are filtered before
signature verification and still return 200; unclassifiable `taskCreated`
deliveries also return 200 — see "Why both events"). A rotated or mismatched
`CLICKUP_WEBHOOK_SECRET` behaves the same way with 401s. ClickUp tracks consecutive
delivery failures per webhook and auto-suspends the webhook after sustained failures.
A suspended webhook stays suspended after the outage is fixed: the bot receives
nothing, logs nothing, and looks healthy.

After ANY sustained failure outage (500s or 401s), check and re-enable the webhook.
Check `health.fail_count` even when `health.status` is still `active`: ClickUp counts
consecutive failures toward auto-disable (~100), and slow responses count too — after
the 2026-07-14 incident the webhook sat at `failing` / `fail_count: 6` from a single
retried delivery. A nonzero fail_count that keeps climbing means deliveries are still
failing (or timing out) and the webhook is walking toward suspension:

```bash
# FIRST: confirm the token itself still has workspace access. "Workspace not
# authorized" (OAUTH_192) from the call below, or a 404 from /team, means the
# token is the problem and no webhook check will be meaningful.
curl -s -H "Authorization: $CLICKUP_API_KEY" "https://api.clickup.com/api/v2/team" | jq .

# health.status must be "active"; a climbing health.fail_count is a warning even before suspension
curl -s -H "Authorization: $CLICKUP_API_KEY" \
  "https://api.clickup.com/api/v2/team/<team_id>/webhook" | jq '.webhooks[] | {id, endpoint, health}'

# re-enable a suspended webhook. Both events are required — dropping
# taskCreated here silently reopens the tag-in-create-call race and the bot
# starts missing ~40% of reported bugs with nothing in the logs.
curl -s -X PUT -H "Authorization: $CLICKUP_API_KEY" -H "Content-Type: application/json" \
  -d '{"endpoint": "https://ai.goodparty.org/clickup/webhook", "events": ["taskTagUpdated", "taskCreated"], "status": "active"}' \
  "https://api.clickup.com/api/v2/webhook/<webhook_id>"

# confirm the subscription still covers both events (a PUT replaces the list)
curl -s -H "Authorization: $CLICKUP_API_KEY" \
  "https://api.clickup.com/api/v2/team/<team_id>/webhook" | jq '.webhooks[].events'
```

## The weekly digest

The section above ends on the failure the error alarm cannot see. This is the
answer to it: `.github/workflows/gpbot-weekly-digest.yml` posts one message to
`#bugs` every Monday at 15:00 UTC summarising the completed Monday–Sunday week.

```
gpbot — week of Aug 17–23
Coverage: 6 of 7 tagged bugs analyzed — 1 missed: DATA-2336
Median time to analysis: 7.3 min
Verdicts: 3 fix · 3 no-code-change · 1 needs-human → 4 tickets kept off the eng queue
PRs: 3 opened · 1 merged · 0 closed unmerged · ⚠️ 1 open past 48h with no human review: #1306
Cost: $38.00 this week · $3.71 median per analysis
```

**Coverage leads, not merges.** "How many bugs did the bot fix" is the wrong
headline twice over. It misprices a triage system whose main output is a written
root cause — of the seven verdicts recorded after escalation went live, four
concluded there was no code fix to make — and it invites gaming, because "PRs
merged" is a number you improve by opening PRs against tickets that are not code
bugs, which is the exact thing `escalation.py` exists to prevent. Coverage is
also where this system has actually failed, and failed silently.

**It posts on a quiet week**, unlike `gpbot-stale-pr-alert.yml`, which stays
silent when it finds nothing. That is right for a nag and wrong here: a missing
digest is indistinguishable from a broken digest, and the Jul 31 – Aug 14 outage
is what "everything looks fine" looks like.

**Raw counts, never percentages.** Three genuinely autonomous bug-fix PRs is not
a base anyone can compute a rate on, and a percentage that reaches Slack reaches
a board deck by Thursday.

**No engineering-time-saved estimate.** The arithmetic needs a per-ticket human
diagnosis time and nothing records one (`time_estimate` and `time_spent` are
empty on all 180 gpbot-touched tasks), so the honest range spans 4x. A weekly
message that restarts an argument about its own inputs stops being read.

### Where each line comes from

| Source | Used for | Auth |
|---|---|---|
| ClickUp `GET /team/{id}/task?tags[]=gpbot-analyze` plus `/task/{id}/comment` | Coverage and latency | `secrets.CLICKUP_API_TOKEN` |
| `gh pr list` | PRs opened / merged / closed unmerged, and open past 48h with no human review | `github.token` |
| `aws logs filter-log-events --filter-pattern GPBOT_METRIC` | Verdicts, deflections and cost | OIDC via `vars.AWS_ROLE_ARN` |

Tickets are bucketed by **creation** date, not by when they were analyzed —
that is the only bucketing under which a ticket nobody looked at appears at all.
The analysis itself is not required to fall inside the window, so a Sunday-night
bug analyzed on Monday counts as covered rather than as a miss.

Bot PRs are identified by title `[GP-Bot]` **or** head branch containing
`/gp-bot_`, the same two signals as `gpbot-ci-drive.yml`. Both are applied to
every open PR; the historical half of the query can only search on the title,
because GitHub's `head:` qualifier matches whole branch names (`head:gp-bot`
returns nothing) and a date-bounded scan of everything truncates silently — a
seven-day `updated:>=` search hit the 200-result cap with the oldest hit three
days old. The gap is therefore a *closed* PR carrying a bot branch and no bot
title, which the implement instruction does not produce.

### A source that failed says so — and so does a source that is merely empty

**"0 missed" from a coverage check that never ran is worse than no message at
all.** Every gather step writes `null` before it makes a call, so a step that
dies leaves the source absent rather than empty, and the module renders that
line as `unavailable`. The cost line never reads `$0` because CloudWatch was
unreachable.

**A healthy query that returns nothing needs the same care**, which the first
production run of this digest proved the hard way. It reported *"Verdicts: no
analyses recorded"* and *"Cost: no runs recorded this week"* for a week whose own
coverage line, three rows above, said seven bugs had been analyzed. CloudWatch
had not failed. It answered honestly, and the answer was zero because
`GPBOT_METRIC` had not shipped yet — which is true of every week before the
deploy, including the first one anybody sees.

So a zero from CloudWatch is only reported as a quiet week when something
independent agrees the week was quiet. ClickUp is that something: coverage
counts analyses from the bot's own ticket comments, by a route that touches
CloudWatch nowhere. Four states, not three:

| CloudWatch | ClickUp | Cost line |
|---|---|---|
| Runs found | — | `$38.00 this week · $3.71 median per analysis` |
| Nothing found | Nothing analyzed either | `no runs recorded this week` |
| Nothing found | Analyses happened | `unavailable`, plus a note saying why |
| Nothing found | Could not be read | `unavailable` — nothing to corroborate the zero against |
| Query failed | — | `unavailable` |

The note names the discriminator, because the symptom alone is not actionable —
the same empty result is expected before the deploy and a real fault after it:

> ⚠️ 7 tickets analyzed but no run metrics exist for this week, so verdicts and
> cost are missing rather than zero. The agent has only recorded them since
> GPBOT_METRIC shipped — an earlier week has none, and a later one means the
> metric has stopped flowing.

**A genuinely quiet week must still read as quiet.** Collapsing "nothing
happened" into "something is broken" would make the digest cry wolf on the weeks
it has least to say, and a warning that fires on a normal week is one people
learn to skip.

A comments fetch that fails takes the **whole** ClickUp source down rather than
that one ticket, because a ticket with no comments reads as un-analyzed: a
single dropped response would otherwise invent a miss and name an innocent
ticket in Slack.

The workflow posts a degraded digest **and then goes red** — the message is
worth having, and so is somebody noticing the gap. The one exception is the
rollout gap above: it is expected every Monday until `GPBOT_METRIC` has covered
a full week, and a job that is expected to be red is a job whose redness stops
meaning anything. It is reported in the message instead, where it will be read.

**One line still has this shape and is not fixed.** If the `gpbot-analyze` tag
stops being applied, the ClickUp query honestly returns nothing and coverage
reads *"no bugs were tagged `gpbot-analyze` this week"*. That sentence is
deliberately about the tagging rather than about the bot, so a reader who knows
bugs were filed can see it is wrong — but nothing corroborates it. Doing so
means counting bugs filed into the Bugs lists as a second denominator, which is
a fourth query and a judgement about which lists count. Worth doing if tagging
ever slips; it was ~100% across W31–W34.

### `GPBOT_METRIC`, and why the agent emits it

`engineer_agent/agent/metrics.py` logs one line at the end of every run:

```
GPBOT_METRIC {"task_id","label","verdict","status","cost_usd","duration_s","escalation"}
```

Before it existed, the verdict and the cost had to be scraped out of prose
across two log groups and joined on an 8-character run id, and rewording either
log line would have broken every query silently. Now the whole query is one
`filter-log-events` call — no Insights query to start and poll, and no join.
Retention on `/ecs/engineer-agent-prod` is 400 days, so a digest that runs late
still finds its week.

Three things about the line are load-bearing:

- **The verdict is `parse_verdict`'s**, the same function that gates escalation,
  so the digest reports the verdicts the system actually acted on rather than a
  second reading of the same text.
- **`escalation` is the outcome string, not a boolean.** A `fix` verdict that
  ended in `disabled`, `already queued` or `escalation failed` is a ticket the
  bot decided to fix and then did not, which is invisible in ClickUp and in
  GitHub alike.
- **An unknown number is `null`, never `0`.** The digest sums costs; one absent
  cost silently coerced to zero would understate the week with nothing anywhere
  to say so.

The field names are a contract with `clickup_bot/weekly_digest.py`. Adding a
field is free; renaming or removing one drops a line from the Monday message and
nothing goes red.

### Changing it

The judgement lives in `clickup_bot/weekly_digest.py` as pure functions over
JSON — no network, no clients — on the same contract as `ci_triage.py`: the
workflow gathers facts and pipes one JSON blob in, the module decides what they
mean. `clickup_bot/tests/test_weekly_digest.py` pins the whole message against
the week of 2026-08-17 as recorded in the gpbot metrics report, so a change that
alters a number has to say so in the diff.

To try it without posting, run the workflow manually with `dry_run` checked and
optionally a `week_start`; the rendered message goes to the job summary.

## Environment Variables

Set by terraform (`infrastructure/environments/prod/clickup-bot/`), not by hand.

| Variable | Description |
|----------|-------------|
| `ECS_CLUSTER_ARN` | ECS cluster the engineer_agent task runs in |
| `ECS_TASK_DEFINITION` | Task definition family (latest revision) or ARN |
| `ECS_SUBNET_IDS` | Comma-separated private subnet IDs for the task |
| `ECS_SECURITY_GROUP_ID` | Security group for the task |
| `ENVIRONMENT` | Selects the `AI_SECRETS_<ENV>` secret that provides `CLICKUP_API_KEY` and `CLICKUP_WEBHOOK_SECRET` |
| `DEDUP_COMMENT_WINDOW_SECONDS` | Optional (default 900): how long a `Processing started` comment blocks re-triggering — see "Dedup semantics" |
| `DEDUP_TABLE_NAME` | DynamoDB table for atomic dedup claims (`clickup-bot-dedup-<env>`). Unset = quiet no-op, comment-based dedup only — see "Dedup semantics" |
| `DEDUP_TTL_SECONDS` | Optional (default 900): lifetime of an atomic dedup claim — see "Dedup semantics" |
| `ENABLE_FARGATE` | Transition compatibility only: the current handler ignores it, but the previous handler silently no-ops without it. Remove from the module only after the fail-loud handler is confirmed live. |

## Adding New Tags

Add to `TAG_CONFIG` in `handler.py`:

```python
TAG_CONFIG = {
    "gpbot-analyze": {"instruction": ANALYZE_INSTRUCTION, "label": "analyze", "model": "opus"},
    "gpbot-work": {"instruction": IMPLEMENT_INSTRUCTION, "label": "implement", "model": "opus"},
    "new-tag": {"instruction": YOUR_INSTRUCTION, "label": "your-label", "model": "opus"},
}
```

## Deployment

Two separate paths. Do not mix them.

**Code deploys with the promotion train.** As of 2026-08-10 Terraform owns this
Lambda's code: a merge to `main` applies it to prod through `promote.yml`, the
same as every other gp-ai component. There is no separate deploy workflow and no
IAM role to provision.

It previously worked the other way — Terraform seeded the code and
`deploy-clickup-bot.yml` owned updates — because applies were hand-run from local
checkouts and a stale one could roll prod back. CI-only applies from the promoted
SHA removed that risk, and that workflow did not survive the move to omni.

**Code and config ship together, in one apply.** Since terraform reclaimed the
code there is no ordering problem left to manage: the release train's
`prod/clickup-bot` apply (`release.yml`) updates the handler and the env vars in
the same run, from the same promoted SHA. A change touching both halves needs no
sequencing.

This was not always true. While `deploy-clickup-bot.yml` owned the code and
terraform owned everything else, the two could land out of order, and the
pre-fail-loud handler silently no-op'd when `ENABLE_FARGATE` was absent — which
is why the module still carries `ENABLE_FARGATE = "true"` in its env map as
transition compatibility. Keep it until a deploy is confirmed on a handler that
no longer reads it.

There is no `clickup-bot-dev` Lambda — only `clickup-bot-prod` exists — so `prod`
is the only environment this deploys.

**Applying by hand** (`infrastructure/environments/prod/clickup-bot/`) is still
possible and is now genuinely dangerous, because an apply from a stale checkout
rolls the handler back along with everything else. Prefer the release train:

```bash
cd infrastructure/environments/prod/clickup-bot
terraform init
terraform plan   # review before applying
terraform apply
```

> **Warning**
> - Do not run `aws lambda update-function-configuration` by hand. Terraform will
>   revert your change on the next apply (drift).
> - Do not run `aws lambda update-function-code` by hand either. Terraform owns
>   the code now; merge to `main` and let the release train apply it.
> - A `terraform apply` from a checkout without the correct variables previously
>   disabled the bot in prod: `enable_fargate_trigger` defaulted to `false` and the
>   real value lived only in a gitignored local `terraform.tfvars`, so an apply
>   without that file stripped the Lambda's `ECS_*` env vars and ECS IAM policy
>   (silent for 12 days, 2026-06-26). Prod defaults are now pinned in that
>   directory's `main.tf`. Always read the plan output before applying.

## ClickUp Webhook Setup

1. Go to ClickUp Settings → Integrations → Webhooks
2. Create webhook with:
   - Endpoint: `https://ai.goodparty.org/clickup/webhook`
   - Events: `taskTagUpdated` **and** `taskCreated` — both, or the bot silently
     misses every bug whose tag arrives inside the create call (see "Why both
     events")
   - Scope: whole workspace (omit `space_id`). The handler filters non-target
     deliveries *before* signature verification precisely because it receives the
     entire workspace's tag updates — a space-scoped webhook would break the outage
     reasoning in Monitoring / "After an outage". The terraform env README
     (`infrastructure/environments/prod/clickup-bot/README.md`) is the source of
     truth for the live webhook (ID, team ID, exact create command).
