# `src/queue/`

Single FIFO SQS queue, consumer only. SQS is an inbox for messages other systems send: the consumer forwards each one to a pg-boss job (`src/jobs/`), which does the work. gp-api sends nothing to it.

- `consumer/queueConsumer.service.ts` — switches on `QueueType` enum and forwards each inbox message to pg-boss
- `inbox/` — the `agentExperimentResult` job's handler, which cannot live in `agentExperiments/` without an import cycle
- `queue.types.ts` — `QueueType` enum and per-type message shapes
- `queue.config.ts` — SQS client config

The `QueueConsumerModule` is excluded when `NODE_ENV === 'test'`.
