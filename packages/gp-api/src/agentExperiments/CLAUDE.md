# Agent Experiments Module

gp-api's side of the PMF Engine contract. Dispatches agent experiment runs to SQS, records them in the `experiment_run` table, and reconciles results from the agent-results queue.

This module is intentionally thin — it is a **transport layer**, not a product layer. It does not know which experiments exist, what params they need, who is allowed to run them, or how artifacts are consumed. Callers own all of that; this module only moves runs through states.

## How It Works

```
caller (gp-api service)
   │
   │  ExperimentRunsService.dispatchRun({ type, organizationSlug, params })
   ▼
DB: INSERT experiment_run (status=QUEUED)       SQS: agent-dispatch-{env}.fifo
                                                         │
                                                         ▼
                                                Lambda → Fargate (PMF Engine)
                                                         │
                                                         ▼
                                                S3: artifact upload
                                                         │
                                                         ▼
                                           SQS: agent-results queue
                                                         │
                                                         ▼
QueueConsumerService.handleAgentExperimentResult
   │
   │  optimistic-locking UPDATE experiment_run
   ▼
status RUNNING → COMPLETED | FAILED,  artifactKey/Bucket, durationSeconds, error
```

### Lifecycle

```
QUEUED  ──► RUNNING           (result.status = "started" — scheduler launched
        │                      the Fargate task)
        │
RUNNING ──► COMPLETED         (result.status = "success")
        └─► FAILED            (result.status = "failed" or "contract_violation",
                              SQS dispatch error, or the ECS task-stopped
                              reaper in gp-ai-projects on a silent task death)
```

Runs are created `QUEUED` and advance to `RUNNING` only when the scheduler emits the `started` callback. `COMPLETED`/`FAILED` are the two terminal states. `contract_violation` at the queue boundary collapses to `FAILED` — the distinction belongs (if anywhere) in the `error` column, not the enum. There is no time-based stale sweeper: a `RUNNING` run whose Fargate task dies without reporting (OOM/SIGKILL/eviction) is reconciled by an ECS task-state-change reaper in gp-ai-projects, which sends a `failed` callback keyed on the task's `startedBy=run_id`. A run enqueued but never dispatched (`QUEUED` forever — a rare ingest-DLQ / scheduler-drop) is **not** auto-reclaimed; it needs manual cleanup.

### Callback idempotency

`handleAgentExperimentResult` uses `optimisticLockingUpdate` on `updatedAt` and guards on a terminal status (`COMPLETED`/`FAILED`) before patching — so a still-`QUEUED` run can still receive a terminal result (covers a `failed` callback that arrives before the `started` one). A duplicate result for an already-terminal run is logged and dropped — this is what makes the ECS reaper safe: a successful run's `success` callback (sent before the task exits) is FIFO-ordered ahead of the reaper's late `failed`, so the reaper can't overwrite it.

## Files

| File                                 | Purpose                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `agentExperiments.module.ts`         | Nest module — exports `ExperimentRunsService`                                                      |
| `services/experimentRuns.service.ts` | `dispatchRun()`, `sweepResumableRuns()` (`@Cron`, compliance resume loop), + inherited Prisma CRUD |

No controller, no schemas, no other services. HTTP surface is a caller concern.

## Typed dispatch contracts

`dispatchRun` is generic over `type`, and `params` is typed against the generated `AgentJobContracts` interface in `src/generated/agent-job-contracts.ts`:

```ts
await experimentRuns.dispatchRun({
  type: 'district_intel',          // keyof AgentJobContracts
  organizationSlug,
  params: { state, city, ... },    // AgentJobContracts['district_intel']['Input']
})
```

`agent-job-contracts.ts` is generated from the per-experiment `manifest.json` files in the `agent-experiment-metadata-dev` S3 bucket (one entry per experiment in `index.json`, each with an `input_schema` and `output_schema`). The PMF Engine writes these manifests; gp-api consumes them as the source of truth for dispatch params and result artifact shapes.

Regenerate after the agent side adds or changes a manifest:

```bash
tsx scripts/generate-agent-job-types.ts
```

The script syncs the bucket to `scripts/output/agent-metadata/`, compiles each `{ Input, Output }` JSON Schema to TypeScript via `json-schema-to-typescript`, and writes `src/generated/agent-job-contracts.ts`. Requires AWS credentials with read access to `agent-experiment-metadata-dev`.

The `experimentType` column on `experiment_run` is still `String` at the DB level — the typing is a compile-time guard on callers, not a DB constraint.

## SQS message shapes

**Dispatch** (gp-api → agent) — produced by `ExperimentRunsService.dispatchRun()`:

```json
{
  "run_id": "<uuid>",
  "params": { ... },
  "organization_slug": "...",
  "experiment_type": "..."
}
```

Sent to the queue named by `AGENT_DISPATCH_QUEUE_NAME` (e.g. `agent-dispatch-dev.fifo`). The URL is resolved once on first dispatch via `sqs:GetQueueUrl` and cached on the service instance. `MessageGroupId = "agent-dispatch-{organizationSlug}"` (per-org FIFO ordering), with a random `MessageDeduplicationId`.

**`params` size cap.** The PMF Engine rejects any dispatch whose serialized `params` exceed **260000 bytes** with `Experiment parameters exceed size limit (N > 260000 bytes)` (a `FAILED` result, not an SQS error). It was 6000 historically — params rode to the agent as an ECS RunTask env var (~8 KB total `containerOverrides` budget). The engine now delivers large params out-of-band via the broker's per-run scope ticket, so the limit that actually binds is the SQS dispatch message itself: AWS caps it at 262144 bytes and the 260000 cap sits just under, leaving room for the envelope. The cap is enforced in gp-ai-projects and rolls out per environment via its release, so a payload above the old 6000 only succeeds once that env runs the new engine. The producer-side trims that predate this (`campaignStrategy`'s `StrategicLandscapeParamsService.fitToBudget`, `raceOpponent`'s `OpponentResearchService` `fitPlatform`) still bound their variable-length data to ~5 KB — now far more conservative than required; relax them only if a caller genuinely needs to send more. A caller embedding unbounded data should still bound it (262144 is the hard SQS ceiling), and one with its own retry loop will otherwise re-dispatch the oversized payload until its attempt cap, producing a cluster of identical `FAILED` rows.

**Result** (agent → gp-api) — consumed by `QueueConsumerService.handleAgentExperimentResult`. Schema in `src/queue/queue.types.ts` (`AgentExperimentResultSchema`):

```ts
{
  runId: string,
  status: 'success' | 'failed' | 'contract_violation',
  artifactKey?: string,
  artifactBucket?: string,
  durationSeconds?: number,
  costUsd?: number,
  error?: string,      // truncated to 1000 chars on write
}
```

Envelope: `{ type: QueueType.AGENT_EXPERIMENT_RESULT, data: <above> }`.

## Reconciling dead runs

There is no time-based stale sweeper. A `RUNNING` run whose Fargate task dies without reporting a result (OOM/SIGKILL/eviction) is reconciled by an **ECS task-state-change reaper in gp-ai-projects**: an EventBridge rule on the pmf-engine cluster fires on task `STOPPED`, and a Lambda sends a `failed` callback (keyed on the task's `startedBy=run_id`) when the container didn't exit cleanly. This is precise — it fires exactly when a task dies — and avoids the false-positives a fixed timeout had against legitimately long runs. The only remaining gap, accepted by design, is a run stuck `QUEUED` forever (enqueued but never dispatched — a rare ingest-DLQ / scheduler-drop); it has no automatic reclaim and needs manual cleanup.

`ExperimentRunsService.sweepResumableRuns` (`*/5 * * * *`) is unrelated — it drives the compliance recovery loop (`AWAITING_RESUME` → re-dispatch), not staleness; it excludes meeting briefings/schedules.

## Data model

`experiment_run` (see `prisma/schema/experimentRun.prisma`):

- `runId` — unique, uuid7, used in SQS messages and by callers
- `organizationSlug` → `Organization.slug`, `onDelete: Cascade`
- `experimentType: String` — opaque to this module; callers define the value space
- `status: ExperimentRunStatus { QUEUED, RUNNING, AWAITING_RESUME, COMPLETED, FAILED, SUPERSEDED }` — `SUPERSEDED` is the terminal marker the resume sweep writes on an `AWAITING_RESUME` predecessor once it dispatches a successor (the old row did real work and handed off; it is **not** a failure — gp-admin renders it green as "Part 1 completed")
- `params: Json`, `artifactBucket/Key`, `durationSeconds`, `error`
- `@@index([organizationSlug, experimentType])`

## Testing

```bash
npx vitest run src/agentExperiments/
npx vitest run src/queue/consumer/queueConsumer.service.test.ts
```

## Environment Variables

- `AGENT_DISPATCH_QUEUE_NAME` — FIFO queue name (e.g. `agent-dispatch-dev.fifo`). The URL is resolved at runtime via `GetQueueUrl` and cached.
- AWS credentials from the standard provider chain (env, IAM role, etc.)

### Preview environments

`AGENT_DISPATCH_QUEUE_NAME` is **not set** in preview envs. Dispatch fails at runtime: the DB row is flipped to `FAILED`, an error is logged, and `dispatchRun` throws `BadGatewayException`. Callers that want to exercise agent dispatch on a PR branch should merge to `develop` and test against dev. (Rationale: per-PR agent queues would require provisioning a matching consumer in `gp-ai-projects` per preview, which isn't worth the cost for a PR verification step.)
