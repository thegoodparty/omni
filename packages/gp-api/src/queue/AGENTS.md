# Queue Module

Single FIFO SQS queue with a strict producer/consumer split.

**SQS is an inbox for messages other systems send. The work runs on pg-boss (`src/jobs/AGENTS.md`).** The consumer checks every inbox message and forwards its data, unchanged, to the pg-boss job of the same name, then acks; the job's worker does the work, with the job system's retries, dead letters, alerts, dashboard and tests. New background work inside gp-api goes straight to pg-boss, never here. The internal job types that have not moved yet still run in the consumer until they are ported. The architecture is fixed: **one queue, switch on `QueueType` enum.** Don't create a new SQS queue for a new message type. CI fails a PR that adds a `QueueType` value (`npm run check:legacy-background-work`); a new message another system sends adds its name to `QUEUE_TYPES` in `scripts/check-legacy-background-work.ts` in the same PR, and a type that moves to pg-boss removes it. An inbox type keeps its `QueueType` value, since that is the contract with its sender.

## Inbox messages

| `QueueType` value (and job name) | Sent by                                 | Job group   | Handler                                                          | Malformed message   |
| -------------------------------- | --------------------------------------- | ----------- | ---------------------------------------------------------------- | ------------------- |
| `pollAnalysisComplete`           | polls pipeline (`gp-ai/serve`)          | poll id     | `PollAnalysisCompleteService` (`polls/`)                         | throws, ages to DLQ |
| `feedbackSynthesisComplete`      | polls pipeline                          | `sourceId`  | `FeedbackSynthesisIngestService.handle` (`constituentFeedback/`) | acked and dropped   |
| `panelRepliesUploaded`           | EventBridge, from an S3 upload          | S3 key      | `OutreachPanelRepliesService.handleUpload` (`outreach/`)         | acked and dropped   |
| `campaignPlanComplete`           | AI campaign plan generation (gp-ai)     | campaign id | `CampaignPlanCompleteService` (`campaigns/tasks/`)               | acked and dropped   |
| `agentExperimentResult`          | gp-ai (PMF Engine, broker, task reaper) | run id      | `AgentExperimentResultService` (`queue/inbox/`)                  | throws, ages to DLQ |

- The job is sent with `sendMany` and keyed by the SQS `MessageId`, so a redelivery of the same message inserts nothing while its job is still in the queue. Workers are still idempotent, since a duplicate send has its own `MessageId`.
- The groups match the `MessageGroupId` each sender sets on SQS, except `panelRepliesUploaded`: EventBridge puts every upload in group `default`, and only one export at a time needs ordering.
- A failed send throws, so SQS redelivers the message.
- `AgentExperimentResultService` lives in `inbox/agentExperimentResult.module.ts`, not `agentExperiments/`: every module whose hook it calls imports `AgentExperimentsModule`, so the handler living there would close an import cycle. Only `AppModule` imports it, and it loads in tests.

A short overview also lives in `README.md`.

## Key files

| Path                                | Purpose                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `queue.types.ts`                    | `QueueType` enum + per-type message data shapes (`QueueMessage` discriminated union) |
| `queue.config.ts`                   | SQS client config (region, queue URL resolution)                                     |
| `producer/queueProducer.module.ts`  | Module imported by anyone enqueuing messages                                         |
| `producer/queueProducer.service.ts` | `enqueue(message: QueueMessage)` — single entry point for sending                    |
| `consumer/queueConsumer.module.ts`  | Excluded when `NODE_ENV === 'test'`                                                  |
| `consumer/queueConsumer.service.ts` | Polls SQS, switches on `QueueType`, forwards inbox messages to pg-boss               |
| `inbox/agentExperimentResult.*`     | The `agentExperimentResult` job's handler and its module                             |

## Patterns

- **Adding a new message type from another system** = five steps: (0) add its name to `QUEUE_TYPES` in `scripts/check-legacy-background-work.ts`, (1) add a `QueueType` enum value + data shape in `queue.types.ts`, (2) put the shape in `@goodparty_org/contracts` so the sending system shares it, (3) add a `JOBS` entry named as the `QueueType` value, with the shape as its schema and a handler in the owning feature module as its worker, (4) add a case in `queueConsumer.service.ts` that parses the message, sends the job with `sendMany` keyed by `message.MessageId`, and acks. The consumer contains no business logic; test the work through the job (`service.jobs.settle()`).
- **Tracking a job's outcome** — if a job's success/failure is something a dashboard asks about, fire the Segment event from the handler (the server is the source of truth for completion, not the frontend) per the `instrument-analytics-event` skill (repo root `.claude/skills/instrument-analytics-event/SKILL.md`).
- **`MessageGroupId` enforces FIFO ordering** per logical key (e.g. `agent-dispatch-{organizationSlug}`). Pick a group that gives you the ordering you actually need; over-broad groups serialize the queue.
- **Not every message has a gp-api producer.** `panelRepliesUploaded` is written by an EventBridge rule on S3 `Object Created` under `agent-replies/` (`deploy/components/panel-replies-ingest.ts`, dev and prod only), with an input transformer building the `{type, data}` body. EventBridge cannot set a deduplication ID, so the queue has content-based dedup on and the body carries the S3 event id; every gp-api producer still sets its own ID, which wins over the content hash. Its job completes without writing for a key or outreach it does not own rather than throwing.
- **Idempotency is the producer/handler's job.** SQS can redeliver. Consumer handlers use `optimisticLockingUpdate` or status guards to drop duplicates (see `agentExperiments` module for the canonical pattern).
- **Import `QueueProducerModule` wherever you enqueue.** Feature modules should depend on the producer side only; never import `QueueConsumerModule` from feature code.

## Email outreach

`emailSendPrepare` (`{ outreachEmailId }`) and `emailInbound` (`{ snsMessageId, bucket, key, fromAuthenticated }`) run on pg-boss now (`src/emailOutreach/AGENTS.md`). Nothing in gp-api sends them to SQS; their consumer cases hand a message the previous release left in the queue to `EmailOutreachQueueService`, which sends the job. `emailInbound`'s job carries only the key, which is SES's message id, and drops a message that names another environment's bucket.

Per-email SES events never go through this queue. Bounce, complaint and send counts are CloudWatch metrics tagged per send, and sending itself runs in a leased sweep that reads Postgres, not SQS. Per-recipient delivery, open and click data goes through Firehose to S3 and is read by a pg-boss schedule (`emailEventSweep`). One queue message per email would back up every other job type behind it.

## Gotchas

- `QueueConsumerModule` is excluded under `NODE_ENV === 'test'`. Test an inbox message's work through its job with `useTestService({ jobs: true })` and `service.jobs.settle()`; `outreach/tests/outreachPanelReplies.test.ts` builds the consumer with the app's `JobsService` to drive a message end to end. Internal types still on SQS are tested by calling the consumer or its `handle*` methods directly.
- The consumer file is intentionally large and switch-based; future refactor will split per-handler. Don't restructure it as part of an unrelated change (Rule 5).
- The SQS client uses the AWS SDK default credential chain in every environment — no env-var special-casing. Deployed tasks get the ECS task role; local work uses whatever the chain resolves (an SSO profile, `AWS_PROFILE`, or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env`).
- Preview environments do **not** set `AGENT_DISPATCH_QUEUE_NAME` — agent dispatch fails fast on PR branches by design.

## Failure modes — what breaks if you get this wrong

These are the SQS-specific failure modes that PR review has caught repeatedly. Each one has caused or nearly caused a real production bug.

- **Stub handler that returns `true` for an unhandled `QueueType` silently drops the message.** SQS acks, nothing reaches the DLQ, no alert fires. A new `QueueType` enum value must land with a real handler case in the same PR — not a placeholder that returns success. If a placeholder is genuinely needed, return `false` (or throw a typed sentinel) so the message ages out to DLQ instead of disappearing.
- **`throw` from inside a handler triggers infinite redelivery, not DLQ.** An unhandled exception bubbles up to SQS, which treats it as transient and requeues the message. The message will redeliver until the queue's redrive policy gives up — potentially hours of retry traffic. Use the framework's failure-return path so the message reaches DLQ on max retries.
- **`enqueue` / `sendMessage` defaults to `throwOnError: false`.** Producer-side failures swallow silently. The DB row commits, the async work never runs, nothing alerts. Either pass `throwOnError: true` for callers that need fail-fast, or check the return value and decide what to do — don't assume success.
- **Credentials in payloads persist at rest.** Don't include `*_token`, `*_url` fields that carry credentials, or Clerk actor-token URLs in `data`. SQS retains messages for the queue's retention window, and the ReceiveMessage IAM scope is coarse. Pass a stable identifier (user ID, campaign ID, request ID); mint the credential in the handler from that identifier.
- **Over-broad `MessageGroupId` serializes unrelated work.** A constant or too-coarse group key (e.g. the literal string `"global"`) makes the queue effectively single-threaded for that type. A too-narrow group breaks the ordering you actually need. Pick the smallest key that preserves required ordering — typically per-campaign or per-organization, not per-app.
- **Transactional state and enqueue must agree on success.** If you commit a DB row that says "queued" and then `enqueue` fails, the row is wrong. If you `enqueue` first and then the DB commit fails, the handler runs against missing state. Enqueue inside the transaction's success path (after `await tx.commit()`-equivalent), or use an outbox pattern. Don't pretend the two-phase problem isn't there.
