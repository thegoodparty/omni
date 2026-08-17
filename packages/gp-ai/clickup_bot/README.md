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

## Why both events (`taskTagUpdated` and `taskCreated`)

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
