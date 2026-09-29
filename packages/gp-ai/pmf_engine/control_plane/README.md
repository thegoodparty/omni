# pmf_engine control plane — dispatch + priority queue

This package turns an agent-run request (an SQS message from gp-api) into a
running Fargate task, under an exact concurrency cap and in priority order.

## Two-stage flow

```
gp-api ──SQS──▶ ingest Lambda ──▶ DynamoDB job queue ──stream/tick──▶ scheduler Lambda ──RunTask──▶ Fargate
(agent-dispatch-{env}.fifo)        (agent-job-queue-{env})                                    │
                                                                          started/failed ─SQS─┘
                                                                          (agent-results-{env}.fifo) ──▶ gp-api
```

### Ingest (`dispatch_handler.py` `handler`)

Consumes `agent-dispatch-{env}.fifo`. Parses + validates the message (identifier
shapes, manifest routing, `input_schema`, scope derivation, params size), then
**writes a `QUEUED` job** to the `agent-job-queue-{env}` DynamoDB table instead of
launching anything. Manifest version IDs are resolved and pinned into the job row
here, so a job dispatched after a long queue wait still runs against the exact
manifest bytes it was validated against. Validation failures send a `failed`
callback to gp-api (unchanged from before). Ingest never mints a broker token and
never calls `run_task`.

### Job queue (`job_store.py`, table `agent-job-queue-{env}`)

Hash key `run_id`. A sparse GSI `queue-index` (hash `gsi_pk="QUEUED"`, range
`queue_sort = "{0|1}#{created_at:013d}"`) holds exactly the waiting backlog and
sorts `HIGH` (rank 0) before `DEFAULT` (rank 1), oldest-first within a tier.
Claiming a job (`QUEUED → LAUNCHING`) removes the GSI keys so it drops out of the
index. TTL cleans up terminal/dispatched rows.

### Scheduler (`scheduler_handler.py` `handler`)

Triggered by the table's **DynamoDB stream on insert** (arrival, seconds) and a
**1-minute EventBridge tick** (slot-freed reconciliation). Pinned to
**reserved concurrency 1**. Each run: count RUNNING-desired Fargate tasks (the
real concurrency) → `slots = MAX_CONCURRENT_AGENTS - running` → query the GSI for
up to `slots` `QUEUED` jobs → for each, conditionally claim it, mint the broker
token, and `run_task`. On launch it sends a `started` callback (gp-api flips
`QUEUED → RUNNING`); on failure a `failed` callback. A stuck-`LAUNCHING` sweep
fails jobs that were claimed but never launched.

## Why the cap is exact

Exactly one scheduler runs at a time (reserved concurrency 1) and it is the only
caller of `run_task`. Two concurrent schedulers would each read the same
`running` count and each claim _different_ jobs, overshooting the cap — the
conditional claim only prevents double-claiming the _same_ job, not overshoot.
`MAX_CONCURRENT_AGENTS` (`max_concurrent_agents` Terraform variable, default 100,
`0` disables) is the cap; the scheduler counts tasks with `desiredStatus=RUNNING`,
which includes PROVISIONING/PENDING, so a just-launched task is counted on the
next tick.

## Priority

Two tiers: `HIGH` and `DEFAULT`. gp-api sets `HIGH` for user-triggered briefing
dispatches; bulk cohort and resume dispatches stay `DEFAULT`. The priority travels
in the SQS message body and is stored on the job row.

## Status flow (gp-api `ExperimentRun`)

`QUEUED` (enqueued) → `RUNNING` (scheduler `started` callback) →
`COMPLETED`/`FAILED`/`AWAITING_RESUME` (terminal callback). gp-api's 45-minute
stale sweep is scoped to `RUNNING`, so queue-wait time does not count against it;
a separate longer backstop sweep reclaims runs orphaned in `QUEUED`.

## Judge override (`_judge_override`)

An eval sweep needs to run a candidate branch's manifest + instruction without
publishing them, because `publish_experiments.py` ships the full experiment set
and rewrites `index.json` last as one global atomic switch. So the candidate's
bytes are staged under a content-addressed
`_judge/<agentId>/<configDigest>/{manifest.json,instruction.md}` folder in the
metadata bucket, and the dispatch message may carry an optional

```json
"_judge_override": { "manifest_key": "...", "instruction_key": "..." }
```

Ingest validates that key shape exactly — every segment pinned, `agentId` equal
to `experiment_type`, both keys in one folder — and requires the dispatch's
`run_id` to match `^_judge-[A-Za-z0-9_-]{1,29}$`. It then reads the override
manifest, accepts only `model`, `max_turns`, `timeout_seconds`, `output_schema`
and `runtime` from it, pins both objects' S3 VersionIds, and puts the key pair
plus those pins on the minted ScopeTicket beside the existing `input_files`
allowlist. Honored in `dev` only, at the broker as well as here.

Two of those fields are less obvious than they look:

- `output_schema` is held to the same Draft-07 object check the Fargate runner
  makes (`runner/config._is_draft7_object_schema`, mirrored because the runner
  ships in the Fargate image and this in the Lambda zip). Without it,
  `{"type": "object"}` with no properties and `{"oneOf": []}` pass and crash at
  container start — and the legacy no-op `{"name": "string"}` shape passes and
  lets the candidate arm run with a schema `Draft7Validator` accepts every
  artifact against, so the judge would score garbage as valid.
- `runtime` is allowed through rather than refused, because the broker serves
  the override manifest *in place of* the published one and 11 of the 16
  published experiments declare one — every one setting
  `max_thinking_tokens: 0`, several also setting `max_parallel_subagents` to
  3..6. Dropped, every candidate arm would silently switch extended thinking ON
  and fan-out OFF, and the sweep would score that config delta instead of the
  branch. It is safe to allow: the runner reads it off the manifest, never an
  env var, and it governs how hard the agent thinks, not what it may touch.

**The gate is on the run, not on the override arm.** A sweep's base arm carries
a judge run id and no `_judge_override` at all, and it gets every consequence
the prefix implies — suppressed callbacks, no reaper callback, no `latest.json` write,
no gp-api row — so `parse_dispatch_message` applies the same checks to any run
id carrying the prefix:

- The run id must `fullmatch` `^_judge-[A-Za-z0-9_-]{1,29}$`. ECS caps
  `startedBy` at 36 characters, dispatch sets it to the run id verbatim, and
  `task_reaper` reads it back to identify the run; a longer id mints a ticket
  and claims the job to `LAUNCHING` before RunTask rejects it on validation, so
  every job in the sweep sticks. `judgeRunId()` in `packages/contracts` builds
  ids that fit. `fullmatch` rather than `startswith` also because the
  envelope's own run-id check is `re.match` on a `$`-anchored pattern, and
  Python's `$` accepts a trailing newline.
- `ENVIRONMENT` must be `dev`. A judge run bypasses gp-api entirely: in prod it
  would spend real money on a run with no `experiment_run` row, write an
  artifact under a real organization's experiment prefix, and suppress every
  signal that would surface it. Mint re-checks this, keyed on `is_eval`, so the
  property holds at the broker too.
- The experiment must not be write-action, either arm. The override arm is
  refused because the behavior allowlist cannot carry `system_prompt` /
  `permission_mode`; the base arm is refused for a worse reason — a write-action
  run writes to gp-api through the broker's `/agent/mcp` proxy, which does not
  read `ticket.is_eval`, so it would make real product writes on a real
  organization with every failure signal suppressed.

**The invariant: a judge run can change what the agent is told to do, never what
it is allowed to touch.** The real experiment is still resolved through the
normal index lookup, and the scope ticket, ECS routing and `input_schema` come
from *that* manifest. A `scope` key in an override manifest — or any other
unrecognised key — is rejected loudly, because `derive_scope` reads
`allowed_tables` / `max_rows` off the manifest and defaults to a hard deny, so a
self-declared scope would let a branch grant itself any Databricks table.

The one documented exception: the ticket's `exp_ttl_seconds` is derived from the
run's *effective* `timeout_seconds`, which on a judge run is the override's. The
ticket has to outlive the run the agent actually gets. It grants nothing a
published manifest could not — the override's timeout is bounded by the same
60..14400 the manifest meta-schema imposes, and mint caps the resulting TTL at
`MAX_TTL_SECONDS` regardless.

The S3 version pin is part of the enforcement, not only race protection: dispatch
vets the override object's contents and the broker reads the same object minutes
later. Unpinned, anyone who can write the key could swap the bytes between those
two reads and the allowlist would have vetted something the agent never runs. So
a `None` VersionId — what S3 returns on an unversioned *or version-suspended*
bucket — is a refusal, not a fallback to "latest", and the ticket's
`ExperimentOverrideRef` requires both pins. `/experiment/manifest` reads with the
ticket's pins and refuses a request pin that disagrees with them.

`_judge-` on the `run_id` is the single marker for "this run has no gp-api
`experiment_run` row". Everything that would otherwise post to
gp-api's results queue for a judge run keys on it:

- `launch_run` mints with `is_eval=true`, which is what tells the broker to
  suppress the results callback from `/artifact/publish` and `/run-status`.
  Mint binds the two together in both directions: `is_eval` may be set exactly
  when the run id carries the prefix. Without that binding a SERVICE_TOKEN
  holder — authenticated, not trusted — could set `is_eval` against a real
  UUIDv7 run id and a genuine product failure would never reach gp-api.
- `scheduler_handler._send_callback` drops the `started` and launch-`failed`
  callbacks (reporting success, since the return value only drives job-state
  bookkeeping and there is no row to orphan).
- `task_reaper` sends no reconciling callback for a dead task, and stops at
  exactly that: the judge branch sits at the send, so the abnormal-stop
  diagnosis (exit code, stopCode, stoppedReason) is logged for a judge run the
  same way it is for a product one. Nothing about the reaper bounds a *live*
  task either way — it is an EventBridge target on `lastStatus=STOPPED` and
  holds `sqs:SendMessage` and nothing else, so it only ever sees tasks that
  have already stopped. What bounds a runaway task is the runner's own
  `asyncio.wait_for(timeout=config.timeout_seconds)` plus `_hard_exit(1)`,
  identical for judge and product runs. The judge's poll timeout stops the
  sweep *watching*; it was never what stops the task.
- A content-level override rejection in dispatch goes to the DLQ rather than
  calling back.
- So does every other rejection. The check lives inside `send_error_callback`
  rather than at its ten call sites, because it is a property of the
  destination and not of any one failure — and one call site runs before
  `parse_dispatch_message` has looked at the message. It returns `False` for a
  judge run, which every caller reads as "the callback did not land, keep the
  SQS message", so a failed judge dispatch reaches the DLQ unnotified. That is
  the opposite choice from `scheduler_handler._send_callback`, which returns
  `True` in the same situation because *its* return value advances job state
  and there is no row to orphan by advancing it.

`is_eval` also stops the publish from touching `<experiment_id>/<org>/latest.json`.
That key is the org's *current* artifact — `artifact_read` serves it on its
legacy no-pin path — so a judge run, possibly executing unpublished
candidate-branch bytes, would replace real product data and then hand it to the
next product run that reads a prior without a pin, with the suppressed callback
making it silent. The immutable per-run archive is what the judge reads, and it
is enough.

`_judge/*` is also the one prefix in the metadata bucket the publish pipeline
does not produce, so nothing upstream bounds an object's size there. Both
readers cap it: the Lambda refuses a manifest over 256 KiB and an instruction
whose HEAD declares over 1 MiB (an OOM in the Lambda returns no
`batchItemFailures`, so every other record in the SQS batch is lost, not just
the judge one), and `/experiment/manifest` caps the override pair at 1 MiB
each (the broker is a shared service, so an OOM there takes every concurrent
run with it). The published pair stays uncapped in both — the publisher is
what bounds that.

`is_eval` is a separate ticket field from `experiment_override` because a
sweep's base arm runs the published bytes with no override and its callback has
to be suppressed too.

With no `_judge_override` present nothing about dispatch changes: the mint body
omits both `experiment_override` and `is_eval`, the enqueued routing carries no
extra key, and the container env is unchanged.
