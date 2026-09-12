# Autopilot

A new isolated service for running agent stages off ClickUp task lifecycle
events. TDD: https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-130813

## Component map

```
ClickUp Webhook → lambda/ (conductor) → agent/ (stage runner)
```

- `lambda/` — the conductor Lambda. Its `handler.py` is the internet-facing
  edge: verifies the ClickUp webhook HMAC, fast-acks with zero ClickUp API
  calls, and self-invokes asynchronously to route the parsed event. See the
  module docstring for the fast-ack/self-invoke design and the incident that
  drove it.
- `agent/` — the stage runner that acts on routed events (Claude Agent SDK).
  Empty placeholder for now; a later task lands its first stage here.

Deliberately isolated from `clickup_bot/`: the webhook mechanics were copied,
not imported, so the two Lambdas can deploy independently.

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
