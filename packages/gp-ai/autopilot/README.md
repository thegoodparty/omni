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
    the incident that drove it.
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

### Environment variables

Beyond the routing/dispatch set (`AUTOPILOT_LIST_IDS`,
`AUTOPILOT_BOT_USER_ID`, `AUTOPILOT_DEDUP_TABLE`, `AUTOPILOT_CLICKUP_WEBHOOK_SECRET`,
`ECS_CLUSTER_ARN`, `ECS_TASK_DEFINITION`, `ECS_TASK_DEFINITION_PLAYWRIGHT`,
`SUBNET_IDS`, `SECURITY_GROUP_ID`), the supervisor and sweep need:

| Var | Purpose |
| --- | --- |
| `AUTOPILOT_CLICKUP_API_KEY` | Plain env var (not Secrets Manager — see `handler.py`'s module docstring for why this Lambda stays that way) for the ClickUp reads/writes `supervisor.py` and `sweep.py` make. |
| `SLACK_BOT_TOKEN` | Bot token for the supervisor's `chat.postMessage` calls (stall alerts, close-out summaries). |
| `AUTOPILOT_SLACK_CHANNEL` | Channel id those messages post to. |
| `SWEEP_LOOKBACK_MINUTES` | How far back the sweep scans for missed transitions (default 45). |
| `SWEEP_MAX_TRIGGERS` | Cap on real dispatches per sweep pass, logged loudly when hit (default 10). Does not bound the unconditional per-executing-card supervisor tick, which is bounded by `AUTOPILOT_MAX_CONCURRENT_STORIES` instead — nor the merge-pending resolution pass, bounded the same way. |
| `AUTOPILOT_MAX_CONCURRENT_STORIES` | How many stories the supervisor will run in flight at once per epic (default **2**). Read fresh at tick time, not at Lambda cold start, so raising or lowering it takes effect on the very next tick with no redeploy. A story with an unmet ClickUp dependency link never launches regardless of this cap. |
| `GITHUB_APP_PRIVATE_KEY` | Same Delegate App key `agent/github_auth.py` uses, from `AI_SECRETS_<ENV>`. `lambda/github_auth.py` mints its own short-lived installation token from it (stdlib-only RS256 signing — no pyjwt/cryptography in this Lambda's zip) to read a story's PR state for merge-pending resolution. |

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
