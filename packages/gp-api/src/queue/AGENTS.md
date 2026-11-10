# Queue Module

Single FIFO SQS queue with a strict producer/consumer split.

**New background work inside gp-api goes on pg-boss (`src/jobs/AGENTS.md`), not here.** This queue stays for messages other systems send (EventBridge, the polls pipeline, agent results) and for the job types that have not moved yet. For those, the architecture is fixed: **one queue, switch on `QueueType` enum.** Don't create a new SQS queue for a new message type.

A short overview also lives in `README.md`.

## Key files

| Path                                | Purpose                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `queue.types.ts`                    | `QueueType` enum + per-type message data shapes (`QueueMessage` discriminated union) |
| `queue.config.ts`                   | SQS client config (region, queue URL resolution)                                     |
| `producer/queueProducer.module.ts`  | Module imported by anyone enqueuing messages                                         |
| `producer/queueProducer.service.ts` | `enqueue(message: QueueMessage)` — single entry point for sending                    |
| `consumer/queueConsumer.module.ts`  | Excluded when `NODE_ENV === 'test'`                                                  |
| `consumer/queueConsumer.service.ts` | Polls SQS, switches on `QueueType` to dispatch handlers                              |
| `consumer/fixtures/`                | Sample SQS payloads for tests                                                        |

## Patterns

- **Adding a new async job** = three steps: (1) add a `QueueType` enum value + data shape in `queue.types.ts`, (2) call `queueProducer.enqueue({ type, data })` from the originating module, (3) add a case in `queueConsumer.service.ts` that calls a handler defined in the owning feature module (e.g. `Nightly10DlcReportService.handleNightlyReport`). The consumer should not contain business logic — it dispatches.
- **Tracking a job's outcome** — if a job's success/failure is something a dashboard asks about, fire the Segment event from the handler (the server is the source of truth for completion, not the frontend) per the `instrument-analytics-event` skill (repo root `.claude/skills/instrument-analytics-event/SKILL.md`).
- **`MessageGroupId` enforces FIFO ordering** per logical key (e.g. `agent-dispatch-{organizationSlug}`). Pick a group that gives you the ordering you actually need; over-broad groups serialize the queue.
- **Not every message has a gp-api producer.** `panelRepliesUploaded` is written by an EventBridge rule on S3 `Object Created` under `agent-replies/` (`deploy/components/panel-replies-ingest.ts`, dev and prod only), with an input transformer building the `{type, data}` body. EventBridge cannot set a deduplication ID, so the queue has content-based dedup on and the body carries the S3 event id; every gp-api producer still sets its own ID, which wins over the content hash. Its handler acks a key or outreach it does not own rather than throwing.
- **Idempotency is the producer/handler's job.** SQS can redeliver. Consumer handlers use `optimisticLockingUpdate` or status guards to drop duplicates (see `agentExperiments` module for the canonical pattern; `P2P_PHONE_LIST_BUILD`'s single-owner claim CAS — `queued -> building`, count 0 = already owned/advanced — plus a stamp-the-token-before-the-slow-write trick to survive a crash mid-build, is another one — `vendors/peerly/services/p2pPhoneListUpload.service.ts`).
- **Import `QueueProducerModule` wherever you enqueue.** Feature modules should depend on the producer side only; never import `QueueConsumerModule` from feature code.

## Domain email forwarding

`domainEmailForwarding` (`{ domainId }`) is enqueued on every gp-api task start by `DomainsService.backfillDomainEmailRedirects`, for each domain with no `emailForwardingDomainId`. Each domain has its own group, `domainEmailRedirect-<domainId>`, and the deduplication ID `domainEmailForwarding-<domainId>`, so a domain whose setup keeps failing holds only itself, never other domains. Copies sent more than 5 minutes apart still arrive; the handler acks a domain that already has forwarding without calling Forward Email.

## Email outreach

Two message types, both from `src/emailOutreach/`:

- `emailSendPrepare` (`{ outreachEmailId }`), enqueued by the email due sweep when a held send starts, and re-enqueued by the same sweep if a prepare stalls. The deduplication ID is `emailSendPrepare-<id>`. SQS only dedupes for 5 minutes, so a retry after that adds a message; prepare is idempotent, so that costs work, not duplicate sends.
- `emailInbound` (`{ snsMessageId, bucket, key, fromAuthenticated }`), enqueued by the public SNS webhook, `POST /v1/email/webhooks/sns`, with `throwOnError: true`. `fromAuthenticated` is SES's DMARC verdict, and forwarding and unsubscribe decisions rely on it. The webhook returns 200 only after the enqueue succeeds, so SNS retries if it fails. Its deduplication ID is `emailInbound-<snsMessageId>`.

Per-email SES events never go through this queue. Bounce, complaint and send counts are CloudWatch metrics tagged per send, and sending itself runs in a leased sweep that reads Postgres, not SQS. Per-recipient delivery, open and click data goes through Firehose to S3 and is read by a cron (`emailEventSweep`). One queue message per email would back up every other job type behind it.

## Gotchas

- `QueueConsumerModule` is excluded under `NODE_ENV === 'test'` — integration tests that need consumer behaviour must call `handle*` methods directly, not through SQS.
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
