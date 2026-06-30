Dispatch a PMF experiment onto Fargate in the cloud (SQS → Lambda → broker → S3), monitor it, and pull/validate the artifact. For *creating* an experiment, see `.claude/skills/build-cap-agent/SKILL.md`; this book is purely about *running* one that already exists.

## Prerequisites

**books/.env variables**: `$AWS_PROFILE` (`work`), `$AWS_REGION` (`us-west-2`)
**Tools**: AWS CLI, `uv` (for republish), `gh` (only if you change code and need a rebuild)
**Access**: the experiment must already be published to `s3://agent-experiment-metadata-<env>/<experiment_id>/` (`manifest.json` + `instruction.md` + optional `attachments/`). Check: `AWS_PROFILE=work aws s3 ls s3://agent-experiment-metadata-dev/<experiment_id>/`

## Architecture (what a dispatch actually does)

```
you ──SQS──► agent-dispatch-<env>.fifo
                  │
                  ▼
        Lambda pmf-engine-dispatch-<env>      validates your params against the manifest input_schema;
                  │                            rejects bad params HERE (no Fargate task launched)
                  ▼
        ECS Fargate task  pmf-engine-<env>     fresh task per dispatch (no warm pool)
                  │
                  ▼
        broker-<env>  (the ONLY egress)        Anthropic (LLM), web fetch/head, Databricks, S3 artifact publish.
                  │                            The task is network-quarantined; everything goes through the broker.
                  ▼
        s3://gp-agent-artifacts-<env>/<experiment_id>/<run_id>/artifact.json   (+ logs/session.jsonl)
```

`<env>` is `dev` | `qa` | `prod`. Use `dev` for testing. The wire field is **`experiment_type`** (NOT `experiment_id`).

## Step 0 — Deploy your change FIRST (the part that trips people up)

What you changed determines what (if anything) you must deploy before dispatching. **The dispatch always runs whatever is currently deployed — it does not pick up your working tree.**

| You changed… | How to make it live | Wait for? |
|---|---|---|
| `instruction.md` / `manifest.json` / `attachments/*` | `cd scripts/python && AWS_PROFILE=work uv run python publish_experiments.py --env=dev` | ~60s (Lambda caches `index.json`) |
| runner / harness code (`pmf_engine/`) | `gh workflow run build-pmf-engine.yml --ref <branch> -f environment=dev` | build to finish (~7 min). Fresh task per dispatch → next dispatch uses it, **no rollover** |
| broker code (`broker/`) | `gh workflow run build-broker.yml --ref <branch> -f environment=dev` | build **AND** rollover — broker-<env> is a long-running ECS service (see "wait for rollover" below) |

**Gotchas (learned the hard way):**
- **`develop` CI clobbers dev.** The dev `index.json` and broker-dev track the `develop` branch. If a `develop` build runs after your manual publish/build, it re-publishes and your eng-branch changes are reverted. After dispatching from an eng branch, re-check your experiment entry is present (`aws s3 cp s3://agent-experiment-metadata-dev/index.json -`), and re-run `publish_experiments.py` if needed.
- **Two concurrent builds race for the `:*-dev` tag.** If you trigger a build twice, the workflow's concurrency group usually cancels the older one; confirm the build you want is the one that finished last.

### Wait for broker rollover (only when you rebuilt the broker)

```bash
AWS_PROFILE=work aws ecs describe-services --cluster broker-dev --services broker-dev \
  --query 'services[0].[deployments[?status==`PRIMARY`].rolloutState | [0], length(deployments)]' --output text
# Ready when it prints:  COMPLETED   1
# (IN_PROGRESS / 2 means the new task is still draining the old one — keep waiting, ~5 min)
```
Dispatching mid-rollover can hit the old task behind the ALB and contaminate your run.

## Step 1 — Dispatch

Params **must satisfy the manifest's `input_schema`** (the Lambda validates before launching). Get the shape from the manifest: `AWS_PROFILE=work aws s3 cp s3://agent-experiment-metadata-dev/<experiment_id>/manifest.json - | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["input_schema"], indent=2))'`

```bash
EXP=opposition_research                       # the experiment_id
RUN_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
ORG="smoke-$(whoami)-$(date +%s)"             # throwaway org slug for tests

BODY=$(cat <<EOF
{
  "experiment_type": "$EXP",
  "run_id": "$RUN_ID",
  "organization_slug": "$ORG",
  "params": { "...": "match the manifest input_schema" }
}
EOF
)

AWS_PROFILE=work aws sqs send-message \
  --queue-url https://sqs.us-west-2.amazonaws.com/333022194791/agent-dispatch-dev.fifo \
  --message-body "$BODY" \
  --message-group-id "agent-dispatch-$ORG" \
  --message-deduplication-id "$RUN_ID"

echo "artifact will land at: s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/artifact.json"
```

FIFO dedup is keyed on `RUN_ID`; use a fresh `RUN_ID` for every dispatch.

(Production path: the real trigger is `POST /v1/agent-experiments/request` on gp-api, which builds this same SQS message after hydrating params. Direct SQS is for testing/headless runs.)

## Step 2 — Confirm the Lambda accepted it and launched a task

```bash
AWS_PROFILE=work aws logs tail /aws/lambda/pmf-engine-dispatch-dev --since 5m --format short \
  | grep -iE "$RUN_ID|Dispatching|Started Fargate task|reject|error"
```
Expect `Dispatching experiment '<exp>' …` then `Started Fargate task: arn:…task/pmf-engine-dev/<task-id>`. **If there is no `Started Fargate task` line, the params were rejected** — the validation error is in this log; fix the params and re-dispatch with a new `RUN_ID`.

## Step 3 — Monitor the run

```bash
# Runner: the agent turn-by-turn (tool calls, completion, cost, errors)
AWS_PROFILE=work aws logs tail /ecs/pmf-engine-dev --since 10m --follow --format short \
  | grep -iE "Experiment:|run_agent.*\[|Agent completed|Cost:|ERROR"

# Broker (only if debugging egress/SSRF/scope): drop health + anthropic noise
AWS_PROFILE=work aws logs tail /ecs/broker-dev --since 10m --format short | grep -vE "health|anthropic"
```
A clean finish logs `Agent completed: N turns, M messages. Cost: $X` then `Published artifact via broker for run <RUN_ID>`.

## Step 4 — Fetch and validate the artifact

```bash
# wait for it, then dump
AWS_PROFILE=work aws s3 cp s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/artifact.json - | python3 -m json.tool

# the full agent session log (every turn, with timestamps + token usage) is alongside it:
AWS_PROFILE=work aws s3 cp s3://gp-agent-artifacts-dev/$EXP/$RUN_ID/logs/session.jsonl /tmp/session.jsonl
```
Schema-valid ≠ functional — eyeball the `markdown`/content. The runner already ran the experiment's `validate_output.py`; a run that produced no artifact failed validation or errored (check the runner log).

## Step 5 — Timing / cold-start (optional)

- **Agent wall-time + per-turn**: `logs/session.jsonl` has a millisecond `timestamp` on every message. Gaps between a tool result and the next tool call are model inference time.
- **Fargate cold start** (dispatch→first agent action is ~45-60s, mostly image pull): the ECS task records the pull window —
  ```bash
  AWS_PROFILE=work aws ecs describe-tasks --cluster pmf-engine-dev --tasks <task-id> \
    --query 'tasks[0].{created:createdAt,pullStart:pullStartedAt,pullStop:pullStoppedAt,started:startedAt}'
  ```
  `pullStart→pullStop` is the image pull; `created→pullStart` is provisioning.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| No `Started Fargate task` in the Lambda log | Params failed `input_schema` validation. The error is in the Lambda log; fix params, new `RUN_ID`. |
| Your instruction/manifest change had no effect | You didn't republish, or a `develop` build clobbered it. Re-run `publish_experiments.py --env=dev`; confirm the entry in `index.json`. |
| Broker code change had no effect | broker-dev hadn't rolled over yet (Step 0) — you hit the old task. |
| Run hangs ~30s+ on a URL, or the agent uses `urllib`/`curl` | The task is quarantined — direct egress fails. The agent must use the broker-proxied `pmf_runtime.http.head/get/download`. (The runtime egress guard now fails these fast with an instructive message.) |
| Artifact never lands | Agent errored or ran out of turns — check `/ecs/pmf-engine-dev` for the run, and `logs/session.jsonl` if it was uploaded. |
| `experiment_id` rejected | The wire field is `experiment_type`, not `experiment_id`. |
