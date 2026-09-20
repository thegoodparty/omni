# Autopilot

A new isolated service for running agent stages off ClickUp task lifecycle
events. TDD: https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-130813

## Component map

```
ClickUp Webhook ─┐
                 ├─→ handler.py → router.py ─┬─→ dispatch.py (Fargate stage) ──→ agent/
GitHub Actions ───┘   (also: sweep.py) ──────┴─→ supervisor.py (epic conductor)
   (cron)
```

- `lambda/` — the conductor Lambda.
  - `handler.py` — the internet-facing edge: verifies the ClickUp webhook
    HMAC, fast-acks with zero ClickUp API calls, and self-invokes
    asynchronously to route the parsed event. Also recognizes the sweep's
    internal invocation shape (`{"autopilot_sweep": true}`, no ALB envelope
    keys). See the module docstring for the fast-ack/self-invoke design and
    the incident that drove it. Also serves `POST /autopilot/slack` (the
    Slack Events API, ENG-11150): same fast-ack/self-invoke discipline, its
    own `AUTOPILOT_SLACK_SIGNING_SECRET`-verified v0 HMAC, and it never
    dispatches a resume itself — it relays a park/notify thread reply onto
    the card as an ordinary, marked ClickUp comment and lets ClickUp's own
    webhook drive the resume through the same hardened `commentPosted` route
    (see "Slack answer intake" below).
  - `router.py` — the routing table + human-actor gate. Maps (card type,
    from-status, to-status) to a stage dispatch or, for the epic-supervisor
    entry points, to `supervisor.py`.
  - `dispatch.py` — the per-transition DynamoDB claim + ECS Fargate launch a
    routed stage dispatch goes through. The `qa` stage launches on the
    Playwright-installed task definition (`ECS_TASK_DEFINITION_PLAYWRIGHT`) —
    the base image has no browsers installed — every other stage on the base
    one (`ECS_TASK_DEFINITION`); an unset `ECS_TASK_DEFINITION_PLAYWRIGHT` at
    a `qa` dispatch refuses loudly rather than falling back to the base image.
  - `supervisor.py` — the epic conductor: reads an epic's stories from
    ClickUp and dispatches every currently-unblocked one, up to
    `AUTOPILOT_MAX_CONCURRENT_STORIES` in flight at once per epic (default
    **2**, env-configurable, read fresh each tick — see the module
    docstring). Each dispatched story holds its own `story#{story_task_id}`
    DynamoDB claim, so N stories under the same epic can each be safely
    in flight; a story with any unmet ClickUp dependency link never
    launches, whatever cap headroom exists. Closes the epic out once every
    story is done, and alerts (once per story) on Slack when a story stalls
    past its per-status TTL. Never auto-retries a stall. Per-epic BUDGET (a
    cost ceiling across the whole run, distinct from this concurrency cap)
    is not built — a later phase.
  - `sweep.py` — the reconciliation backstop, invoked on a GitHub Actions
    cron (`.github/workflows/autopilot-sweep.yml`, not Terraform — see that
    workflow for why). Re-derives missed transitions from ClickUp's current
    board state through the exact same `router.route()` + dispatch path the
    webhook uses, and unconditionally ticks the supervisor for every card
    currently sitting in "executing". Also resolves every story parked on a
    "Merge pending: PR #n" note (see `story.md` step 6): one GitHub read
    (`github_auth.py` mints a short-lived installation token from the
    Delegate App key, stdlib-only — this Lambda ships no pip-installed
    dependencies) decides whether to move the story to `qa` and launch its QA
    run, alert Slack once if the PR closed unmerged, or leave an open PR's
    park untouched. This is what lets a story stage end at "approved,
    auto-merge armed" instead of waiting out the merge and the release train
    in a paid Fargate run.
- `agent/` — the stage runner that acts on routed events (Claude Agent SDK).

Deliberately isolated from `clickup_bot/`: the webhook and sweep mechanics
were copied, not imported, so the two Lambdas can deploy independently. In
particular, ClickUp reads inside this Lambda are plain HTTP (mirroring
`clickup_bot`'s client), never `shared/clickup_client` — that module is the
Fargate stage runner's tool, not the conductor's.

## Board contract for humans

This is the contract the routing table (`router.py`) and the stage
instructions (`agent/stages/*.md`) are both written against. Changing either
side without the other breaks routing silently — a card can sit in a status
the bot never dispatches from, or vice versa.

**Intake.** A feature card enters the pipeline by being moved into
`approved tdd`, and its description **must** link the approved TDD. That's
the only source of design the `epic-create` stage will read — it never
invents architecture, data model, or scope. A card missing the link doesn't
fail; the run parks and asks (`agent/stages/epic-create.md`, step 1), and a
human answering the question (or moving the card back) re-dispatches a fresh
`resume` run to pick the stage back up.

**Board shape.** ONE ClickUp list holds both card kinds: a feature card is a
top-level task, a story is a subtask of its feature card — parenthood is how
the conductor tells them apart (`router.derive_card_type`), not list
membership. Real ClickUp deliveries carry no list, status, or parent, so the
async worker hydrates all three with one task read before routing
(`handler._hydrate_from_clickup`); the fast-ack edge stays fetch-free.

**Status spec** (`router.py`'s `STATUS_*` constants are the source of
truth — a board relabel without a matching code change breaks routing):

| Status | Feature card means | Story means |
| --- | --- | --- |
| `approved tdd` | intake: TDD approved, awaiting kickoff | queued (fresh stories land here) |
| `in progress` | epic-create is planning | story stage is implementing |
| `feedback needed` | breakdown posted for review, or a parked question | parked question / QA findings |
| `executing` | breakdown approved; stories are being dispatched | (never used) |
| `qa` | (never used) | merged, QA verifying |
| `done` | every story done | shipped and verified |

`executing` must stay distinct from `in progress` on the feature card: the
sweep unconditionally drives every epic sitting in `executing`, and folding
it into `in progress` would let a sweep tick dispatch stories while
epic-create is still mid-breakdown, before the human approved it.

Every card arriving in `feedback needed` pings the Slack channel, park and
finished breakdown alike — a park does it as part of the park primitive, and
epic-create's handoff does it with `feedback notify` (the ping without the
card writes). Nobody is expected to watch the board.

**The two human gates.** A transition into `GATE_TO_STATUSES` only dispatches
when the actor is a human — `router.py` checks the moving user against
`AUTOPILOT_BOT_USER_ID` and refuses (never dispatches) when they match:

- `approved tdd` → `in progress` (feature card): starts breakdown
  (`epic-create` stage — turns the TDD into a linked story breakdown).
- `feedback needed` → `executing` (feature card): starts implementation
  (hands the card to the epic supervisor, which dispatches stories one at a
  time).

The bot never moves a card through either gate itself — every other status
write it makes (landing a story in `qa`, closing an epic out, etc.) is a
non-gate transition a bot actor is expected to make.

## Slack answer intake (ENG-11150)

Every park/notify ping already lands in `#autopilot` with the card link
(`agent/feedback.py`'s `_slack_message`/`_notify_message`). Replying in that
Slack thread now resolves the question too, without a ClickUp round-trip:

1. `POST /autopilot/slack` (Slack Events API) verifies the request's v0 HMAC
   against `AUTOPILOT_SLACK_SIGNING_SECRET`, answers `url_verification`
   in-path, and fast-acks + self-invokes exactly like the ClickUp path — see
   `handler.py`'s "Slack ingress" section.
2. The async worker (`handle_slack_async_processing`) filters to genuine
   human thread replies in `AUTOPILOT_SLACK_CHANNEL`
   (`router.is_relayable_slack_reply`), claims a dedup key off the Slack
   event id (same DynamoDB table `dispatch.py`'s per-transition claims use,
   so a Slack redelivery relays once), fetches the thread root
   (`conversations.replies`), and confirms it's one of our own pings
   (`router.slack_ping_task_id`, matched against the card link embedded in
   the ping text).
3. It relays the reply onto the card as an ordinary ClickUp comment marked
   `[autopilot:slack-answer from <slack user>] <text>`
   (`supervisor.create_task_comment` + `router.format_slack_answer_comment`)
   — nothing more. It never dispatches a resume itself: ClickUp's own
   webhook fires for that new comment and drives it through the exact same
   hardened `commentPosted` route a human's own ClickUp comment takes. The
   dedup claim is taken before either API call, so a transient blip on
   either one (not a sustained outage) is covered by a short bounded retry
   (`handler._retry_relay_call`) rather than silently dropping the answer —
   this Lambda's async self-invoke gets zero platform retries
   (`maximum_retry_attempts = 0`) and Slack already has its 200 from the
   fast-ack edge, so nothing else would recover it.
4. That route's self-resume guard (which otherwise ignores every bot-authored
   comment — a park's own parking comment must not resume the stage that just
   parked) carries EXACTLY ONE exemption for this marker
   (`router.is_slack_relay_comment`). Nothing else is exempted, so a relayed
   answer can trigger at most one resume: the run it wakes may itself
   re-park, but a re-park comment carries `PARK_MARKER`, never
   `SLACK_ANSWER_MARKER`, so it hits the same filter unexempted.

Additive: ClickUp comments and status drags keep resolving parks exactly as
before.

**Manual ops step (not done by this change — do this in the Slack app admin
console for `gp_ai_bot`):**

- Enable Event Subscriptions on the app, pointed at this environment's
  `https://<ai ALB host>/autopilot/slack`.
- Subscribe to the `message.channels` bot event.
- Confirm the bot's OAuth scopes include `channels:history` — needed for the
  `conversations.replies` thread-root read; `chat:write` (already granted for
  park/notify) does NOT imply it.
- `gp_ai_bot` must be a member of `#autopilot` for `chat.postMessage` (it was
  invited 2026-09-19); Events API delivery does not require membership, but
  `conversations.replies` does.
- Confirm the bot's OAuth scopes include `pins:write` — needed to pin the
  status card message below. The pin itself is cosmetic (a failed pin never
  blocks the card from updating), so a missing scope degrades to an
  unpinned-but-still-current message rather than breaking anything.

## Pipeline status surface (ENG-11151)

Two cheap, board-and-Slack-only surfaces answer "what is running, cost,
logs" without any new infra — deliberately NOT a Postgres/CloudWatch
dashboard (that's phase 3):

1. **Run summaries on the card.** Every stage run — `agent/main.py`'s
   epilogue, after the run has already finished and its `parked_stage` (if
   any) is known — posts a ClickUp comment on its own card: stage, outcome,
   cost, duration, and the PR link if the run's own final message mentions
   one (`metrics.run_summary` / `metrics.format_run_summary_comment`, fed by
   the same dict `format_metric_line` logs, so the two can never disagree).
   Comment-post failure is logged and swallowed — it must never turn an
   already-decided run result into a different one (`main.post_run_summary_comment`).

   The comment's first line carries a machine-readable marker,
   `[autopilot:run-summary stage=<stage> outcome=<outcome> cost_usd=<cost>]`
   — duplicated in `lambda/router.py` as `RUN_SUMMARY_MARKER_PATTERN` (same
   dependency-light reason `PARK_MARKER_PATTERN` is duplicated there; a
   contract test pins the two character-identical).

   **The one interaction this marker exists to solve:** every run — INCLUDING
   a run that itself just parked — posts this comment at the end, so it
   always lands with a later timestamp than the park it describes. Treating
   "any comment after a park" as a human reply (the sweep's
   `auto_resume_actionable_parks`) would therefore wrongly mark that park
   "answered" and permanently wedge it: the comment-resume route already (and
   correctly) drops the same comment too, as a bot-authored write carrying
   neither `PARK_MARKER` nor `SLACK_ANSWER_MARKER`. The fix excludes a
   run-summary comment from that check BY MARKER, not by author — a blanket
   "ignore every bot-authored comment" would also swallow a genuine relayed
   Slack answer, which is bot-authored via the same ClickUp API key and must
   still count as an answer.

2. **A pinned #autopilot status card**, maintained by the sweep
   (`lambda/sweep.py`'s `update_status_card`, ticked every 15 minutes same as
   the rest of the sweep — eventually consistent by design, not made fresher
   with extra queries): feature cards executing / in progress, each
   executing epic's in-flight story (from the supervisor's own
   epic-in-flight DynamoDB claim — "active claims" — not a new ClickUp
   query) with that story's last-run outcome/cost read straight off its
   newest run-summary comment (`router.latest_run_summary`), and stories
   awaiting feedback. Built purely from board reads + comment reads the
   sweep already makes elsewhere; no new ClickUp query family and no log
   access — cost is exactly what a human would read off the card's own
   comment thread.

   The message's Slack ts is stored under the fixed DynamoDB key
   `status_card` (same table as every other autopilot claim, a separate key
   family) so the next tick edits it in place via `chat.update` instead of
   posting a fresh message every 15 minutes. If that edit fails (most likely
   the message was deleted), the sweep posts fresh, re-pins, and stores the
   new ts — self-healing within one tick. The pin is best-effort and never
   fails the tick; the sweep always finds its message by the stored ts, never
   by scanning pins.

### Environment variables

Beyond the routing/dispatch set (`AUTOPILOT_LIST_IDS`,
`AUTOPILOT_BOT_USER_ID`, `AUTOPILOT_DEDUP_TABLE`, `AUTOPILOT_CLICKUP_WEBHOOK_SECRET`,
`ECS_CLUSTER_ARN`, `ECS_TASK_DEFINITION`, `ECS_TASK_DEFINITION_PLAYWRIGHT`,
`SUBNET_IDS`, `SECURITY_GROUP_ID`), the supervisor and sweep need:

| Var | Purpose |
| --- | --- |
| `AUTOPILOT_CLICKUP_API_KEY` | Plain env var (not Secrets Manager — see `handler.py`'s module docstring for why this Lambda stays that way) for the ClickUp reads/writes `supervisor.py` and `sweep.py` make. |
| `SLACK_BOT_TOKEN` | Bot token for the supervisor's `chat.postMessage` calls (stall alerts, close-out summaries) and the Slack ingress's `conversations.replies` thread-root read. |
| `AUTOPILOT_SLACK_CHANNEL` | Channel id those messages post to, and the channel the Slack ingress requires a reply to be in. |
| `AUTOPILOT_SLACK_SIGNING_SECRET` | Verifies `POST /autopilot/slack` requests really came from Slack (v0 HMAC over the raw body). Missing/empty fails closed (every request 401s). |
| `SWEEP_LOOKBACK_MINUTES` | How far back the sweep scans for missed transitions (default 45). |
| `SWEEP_MAX_TRIGGERS` | Cap on real dispatches per sweep pass, logged loudly when hit (default 10). Does not bound the unconditional per-executing-card supervisor tick, which is bounded by `AUTOPILOT_MAX_CONCURRENT_STORIES` instead — nor the merge-pending resolution pass, bounded the same way. |
| `AUTOPILOT_MAX_CONCURRENT_STORIES` | How many stories the supervisor will run in flight at once per epic (default **2**). Read fresh at tick time, not at Lambda cold start, so raising or lowering it takes effect on the very next tick with no redeploy. A story with an unmet ClickUp dependency link never launches regardless of this cap. |
| `GITHUB_APP_PRIVATE_KEY` | Same Delegate App key `agent/github_auth.py` uses, from `AI_SECRETS_<ENV>`. `lambda/github_auth.py` mints its own short-lived installation token from it (stdlib-only RS256 signing — no pyjwt/cryptography in this Lambda's zip) to read a story's PR state for merge-pending resolution. |

## Retry budget, end to end (ENG-11154)

What actually retries a missed or failed transition, in the order a card
hits them, and where it ends if nothing does:

1. **Webhook delivery has zero platform retries.** `handler.py`'s async
   self-invoke (both the ClickUp path and the Slack ingress) is configured
   with `aws_lambda_function_event_invoke_config.maximum_retry_attempts = 0`
   (`infrastructure/modules/autopilot-bot/main.tf`) — a failure inside that
   invocation is not retried by AWS. ClickUp itself does redeliver a slow-
   acked webhook, which `dispatch.claim_transition`'s dedup absorbs (see
   `handler.py`'s module docstring), but a webhook that never arrives, or
   whose async worker dies mid-flight, has no platform-level second try.
   That gap is what everything below exists to close.

2. **The sweep is the retry**, on a 15-minute GitHub Actions cron
   (`.github/workflows/autopilot-sweep.yml`, not Terraform). Every tick
   (`sweep.handle_sweep`) re-derives what a lost webhook would have
   delivered from ClickUp's current board state and feeds it through the
   same `router.route()` + `dispatch.claim_transition` path — see the
   module docstring for the full mechanism. Two things bound how much a
   single tick can redo:
   - `SWEEP_LOOKBACK_MINUTES` (default 45, `sweep.sweep_lookback_ms`) — how
     far back `list_recently_updated_tasks` scans for a card whose status
     changed with no matching dispatch.
   - `SWEEP_MAX_TRIGGERS` (default 10, `sweep.sweep_max_triggers`) — a cap
     on real dispatches from that scan per tick (`sweep.handle_sweep`'s
     `cap_hit` logging); the remainder waits for the next tick. It does not
     bound the unconditional executing-card ticks, the stall alerts, merge-
     pending resolution, or auto-resume below — each of those is
     self-limiting by board shape instead (see their own docstrings).
   - **Ambiguous-pair skip**: `sweep._from_status_for_current` reverse-looks-up
     `router.ROUTING_TABLE` for the one `from_status` that reaches a card's
     current status; when more than one row could (e.g. a story reaching "in
     progress" from both kickoff and a feedback-resume), the transition is
     skipped rather than guessed — reconstructing the wrong one against a
     legitimately mid-run story would dispatch a duplicate. A feature card
     sitting in "in progress" is skipped outright for the same reason (a
     comment or rename bumps `date_updated` without a real transition). Skips
     here are not silent: `alert_stalled_in_progress_feature_cards` covers the
     feature-card case with a one-time Slack alert past
     `supervisor.STATUS_TTL_SECONDS[router.STATUS_IN_PROGRESS]`, and a stuck
     story surfaces the same way via its own status TTL below.

3. **Stall alerts are the backstop for what the sweep can't re-drive** — never
   an auto-retry, always exactly one Slack post. `supervisor.STATUS_TTL_SECONDS`
   sets the ceiling per status a story can sit in before it counts as stalled:
   `STATUS_IN_PROGRESS` 2h, `STATUS_QA` 1h, `STATUS_EXECUTING` 30min (a manual
   drag only — stories don't reach it in the normal pipeline). `feedback
   needed` carries no TTL: waiting on a human isn't a stall. Claimed once via
   `supervisor.try_claim_stall_alert` (an epic-scoped claim) for stories inside
   an executing epic, and via the same claim item for the feature-card case in
   `alert_stalled_in_progress_feature_cards`.

4. **Merge-pending resolution** (`sweep.resolve_merge_pending_parks`) is a
   free retry, not a paid one: a story parked on "Merge pending: PR #n" gets
   one GitHub read (`sweep.fetch_pull_request`) per tick, uncapped by
   `SWEEP_MAX_TRIGGERS`. Merged moves it straight to `qa` and launches QA
   (`sweep._dispatch_qa_after_merge`, claimed on the PR number so two ticks
   discovering the same merge only launch once); closed-unmerged posts one
   Slack alert (`sweep._alert_closed_unmerged_pr`, claimed the same way,
   `CLOSED_PR_ALERT_TTL_SECONDS` = 30 days); still open leaves the park
   untouched. Runs BEFORE auto-resume in the same tick, and every merge-pending
   park it finds is excluded from auto-resume regardless of outcome — a paid
   resume must never race this free check for the same park.

5. **Auto-resume** (`sweep.auto_resume_actionable_parks`) retries a parked
   story whose park is a status note or a stranded run, not a question — see
   its own docstring for the exact skip list (QA-failed parks, any park with a
   reply already posted, merge-pending parks). Deduped per park instance on
   the park comment's own id, so a fresh re-park always earns exactly one more
   try. Bounded by `AUTO_RESUME_MAX_PARKS` (10) — a count of park markers on
   the thread, not a relapse streak, because a healthy story legitimately
   accrues several along the way (merge-pending, deploy-pending, a stranded
   run).

6. **Dead-letter tag: what happens when the retry budget runs out.**
   Hitting `AUTO_RESUME_MAX_PARKS` on a story does not retry again — it ends
   the automated retry budget for that park cycle and hands the story to a
   human, board-visibly (`sweep._escalate_dead_letter`):
   - Tags the story `router.DEAD_LETTER_TAG_NAME` (`dead-letter`) via
     `supervisor.add_task_tag`, and posts exactly one Slack escalation.
     Claimed on the park comment's own id (`sweep.DEAD_LETTER_ALERT_STAGE`,
     `sweep.DEAD_LETTER_ALERT_TTL_SECONDS` = 30 days) — the SAME unit
     `auto_resume_actionable_parks` dedups auto-resumes on, so "one park
     cycle" means the same thing on both sides of this feature.
   - The claim is taken BEFORE the tag write, not after: a human who removes
     the tag to take ownership does not stop the story from still sitting
     past the cap on the very next 15-minute tick (nothing else about the
     park changes when they remove it), so tagging first would silently
     re-tag it right back. Claiming first means every tick after the winning
     one finds the claim already taken and returns before ever touching the
     tag — the removal sticks until a genuinely new park (a new comment id,
     a fresh unclaimed key) comes along.
   - `router.has_dead_letter_tag` excludes a tagged story from
     `auto_resume_actionable_parks` entirely, checked off the task dict the
     sweep already fetched (no extra ClickUp read) — a dead-lettered story
     stays a human's until they remove the tag.
   - No new status and no new AWS infra: a status change would need a
     `router.ROUTING_TABLE` entry on both the feature-card and story sides
     (see "Board contract for humans" above); a tag is API-manageable and
     board-filterable without touching routing at all.

## Testing

`lambda` is a Python keyword, so `lambda/handler.py` cannot be reached with a
normal dotted import (`from autopilot.lambda import handler` is a syntax
error). `tests/conftest.py` loads it directly from its file path under a
private `sys.modules` key instead of the sys.path-insertion + bare `import
handler` trick `clickup_bot/tests/` uses — the whole gp-ai suite runs in one
`pytest` process (see the root `Makefile`'s `TEST_PATHS`), and a bare `handler`
module name would collide with clickup_bot's.

Run just this member's suite from `packages/gp-ai`:

```bash
uv sync --all-packages
uv run pytest autopilot/
```
