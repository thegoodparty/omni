# `src/queue/`

Single FIFO SQS queue with producer/consumer split. SQS is an inbox for messages other systems send: the consumer forwards each one to a pg-boss job (`src/jobs/`), which does the work.

- `producer/` — anywhere in the app that needs to enqueue a message goes through here
- `consumer/queueConsumer.service.ts` — switches on `QueueType` enum; forwards inbox messages to pg-boss and dispatches the internal types not yet ported (large file)
- `inbox/` — the `agentExperimentResult` job's handler, which cannot live in `agentExperiments/` without an import cycle
- `queue.types.ts` — `QueueType` enum and per-type message shapes
- `queue.config.ts` — SQS client config

The `QueueConsumerModule` is excluded when `NODE_ENV === 'test'`.
