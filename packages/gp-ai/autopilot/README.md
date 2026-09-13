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
    ClickUp, dispatches the next unblocked one (one in flight per epic, via
    its own `epic#{epic_task_id}` DynamoDB claim), closes the epic out once
    every story is done, and alerts (once) on Slack when a story stalls past
    its per-status TTL. Never auto-retries a stall.
  - `sweep.py` — the reconciliation backstop, invoked on a GitHub Actions
    cron (`.github/workflows/autopilot-sweep.yml`, not Terraform — see that
    workflow for why). Re-derives missed transitions from ClickUp's current
    board state through the exact same `router.route()` + dispatch path the
    webhook uses, and unconditionally ticks the supervisor for every card
    currently sitting in "executing".
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

**Status spec** (`router.py`'s `STATUS_*` constants are the source of
truth — a board relabel without a matching code change breaks routing):

| List | Statuses |
| --- | --- |
| Feature ("Autopilot features") | `approved tdd`, `in progress`, `feedback needed`, `breakdown review`, `executing`, `done` |
| Story ("Autopilot stories") | `to do`, `executing`, `in progress`, `feedback needed`, `qa`, `done` |

**The two human gates.** A transition into `GATE_TO_STATUSES` only dispatches
when the actor is a human — `router.py` checks the moving user against
`AUTOPILOT_BOT_USER_ID` and refuses (never dispatches) when they match:

- `approved tdd` → `in progress` (feature card): starts breakdown
  (`epic-create` stage — turns the TDD into a linked story breakdown).
- `breakdown review` → `executing` (feature card): starts implementation
  (hands the card to the epic supervisor, which dispatches stories one at a
  time).

The bot never moves a card through either gate itself — every other status
write it makes (landing a story in `qa`, closing an epic out, etc.) is a
non-gate transition a bot actor is expected to make.

### Environment variables

Beyond the routing/dispatch set (`AUTOPILOT_LIST_IDS`, `AUTOPILOT_STORY_LIST_IDS`,
`AUTOPILOT_BOT_USER_ID`, `AUTOPILOT_DEDUP_TABLE`, `AUTOPILOT_CLICKUP_WEBHOOK_SECRET`,
`ECS_CLUSTER_ARN`, `ECS_TASK_DEFINITION`, `ECS_TASK_DEFINITION_PLAYWRIGHT`,
`SUBNET_IDS`, `SECURITY_GROUP_ID`), the supervisor and sweep need:

| Var | Purpose |
| --- | --- |
| `AUTOPILOT_CLICKUP_API_KEY` | Plain env var (not Secrets Manager — see `handler.py`'s module docstring for why this Lambda stays that way) for the ClickUp reads/writes `supervisor.py` and `sweep.py` make. |
| `SLACK_BOT_TOKEN` | Bot token for the supervisor's `chat.postMessage` calls (stall alerts, close-out summaries). |
| `AUTOPILOT_SLACK_CHANNEL` | Channel id those messages post to. |
| `SWEEP_LOOKBACK_MINUTES` | How far back the sweep scans for missed transitions (default 45). |
| `SWEEP_MAX_TRIGGERS` | Cap on real dispatches per sweep pass, logged loudly when hit (default 10). Does not bound the unconditional per-executing-card supervisor tick, which is bounded by the one-story-per-epic invariant instead. |

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
