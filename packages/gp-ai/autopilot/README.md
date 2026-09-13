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
    routed stage dispatch goes through.
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

### Environment variables

Beyond the routing/dispatch set (`AUTOPILOT_LIST_IDS`, `AUTOPILOT_STORY_LIST_IDS`,
`AUTOPILOT_BOT_USER_ID`, `AUTOPILOT_DEDUP_TABLE`, `AUTOPILOT_CLICKUP_WEBHOOK_SECRET`,
`ECS_CLUSTER_ARN`, `ECS_TASK_DEFINITION`, `SUBNET_IDS`, `SECURITY_GROUP_ID`),
the supervisor and sweep need:

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
