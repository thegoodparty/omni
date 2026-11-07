# Jobs (pg-boss)

Background jobs on [pg-boss](https://pgboss.io): a job queue that lives in the
gp-api Postgres database, schema `pgboss`. Workers run inside every gp-api
task. New background work goes here, not on the SQS queue (`src/queue/`).

## Key files

| Path                           | Purpose                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `jobs.registry.ts`             | `JOBS`: each job's schema, queue and worker options, and its worker |
| `jobs.service.ts`              | `send()`, queue setup, workers, queue metrics                       |
| `jobs.module.ts`               | `@Global()`: any provider can inject `JobsService`                  |
| `scripts/pg-boss-migration.ts` | Writes the Prisma migration for the pgboss schema                   |
| `scripts/jobs-dead-letter.ts`  | Lists, redrives or deletes dead-lettered jobs                       |

## Adding a job

1. Add an entry to `JOBS` in `jobs.registry.ts`, wrapped in `defineJob()`:
   - `schema`: the payload (Zod).
   - `queue`: retries, backoff, `expireInSeconds`.
   - `work`: `localConcurrency`, and `groupConcurrency` if jobs that share a
     group must not run at once.
   - `policy`: only for strict ordering (§ Ordering).
   - `maxWaitMinutes` (required): how long a job may sit ready before the
     queue's backed-up alert fires. Set it to the longest a user or a
     downstream step can wait, not to the job's run time.
   - `worker`: `(job, { get }) => get(SomeService).doTheWork(job)`. `get`
     reaches any provider in the app. One key, one worker: a queue cannot
     have two.
2. Send it: `await this.jobs.send('<name>', data, options)`.

Only `jobs.module.ts` imports the registry at runtime. Workers import feature
services, and feature services import `JobsService`, so `jobs.service.ts`
imports it as types only and receives it through Nest. Keep it that way.

The payload is typed from the schema, and checked against it on send and
again before the worker runs. Every queue heartbeats every 60s, so a task
that dies mid-job has its job retried elsewhere within about two minutes.

## Sending

- `send()` throws when the data fails its schema or the insert fails. Nothing
  is swallowed; let it propagate or handle it.
- **In a transaction:** pass `{ tx }` from `this.client.$transaction(async
(tx) => ...)`. The job commits or rolls back with your writes, so a row that
  says "queued" always has a job. Use this whenever a status change and a job
  go together.
- `group: { id }` with the job's `groupConcurrency` limits how many jobs in a
  group run at once, across every task. See § Ordering.
- `singletonKey`, `startAfter`, `priority`: see the pg-boss `send()` docs.

## Ordering

A `standard` queue runs jobs roughly oldest first and promises no order. Pick
what the work actually needs:

- **One at a time per key, order loose.** `work: { groupConcurrency: 1 }`,
  send with `group: { id: key }`. Jobs for one key never overlap, across
  every task. A job waiting on a retry can be overtaken by a later job for
  the same key. Contact imports use this, keyed by org.
- **Strict order per key (FIFO).** `policy: 'key_strict_fifo'`, send every
  job with `singletonKey: key`. Jobs for one key run one at a time in send
  order, and a job in retry holds back the jobs behind it. A job that fails
  for good blocks its key until the failed job is deleted; the dead-letter
  script does that when it redrives or deletes the dead letter. A redriven
  job goes to the back of its key, behind jobs sent while it was dead, so
  if order matters more than the work, delete it instead. Other keys never
  wait. Fetch cost grows with the number of keys holding queued jobs, so
  key by something coarse (an org), not by a row.
- **One at a time for the whole queue.** `policy: 'singleton'`.

`policy` is set when the queue is created and cannot change; a new policy
means a new queue name.

## Workers

- Keep the worker thin: fetch the service that owns the work and call it.
- Return to complete the job. Throw to fail it: pg-boss retries up to
  `retryLimit`, then moves it to the job's dead-letter queue.
- Workers must be retry-safe and idempotent: running a job twice, or
  resuming after an attempt died halfway, must leave the same result. A task
  can die mid-job, a deploy stops every task, and a worker that only looked
  dead can still be running when its retry starts.
- Long workers should check `job.signal.aborted` at safe points and throw.
  The signal aborts when the task shuts down (20s grace, then the job is
  retried elsewhere) or the job outruns `expireInSeconds`.
- `job.retryCount >= job.retryLimit` is the last attempt. Use it to record a
  user-visible failure before throwing.

## Payload changes

Old and new code run side by side during a deploy, and both work the same
queues. A payload change must be readable by the previous release: add
fields as optional, never rename or remove one in the same release that
starts sending the new shape.

## Dead letters

Every job's queue has a dead-letter queue, `<name>-dlq`, that no worker
reads. The `jobs-dead-letter` alert fires once per dead-letter queue that
holds a job (`pgboss_queue_jobs` in Grafana, prod). Handle one with
`scripts/jobs-dead-letter.ts`, with `DATABASE_URL` set to the gp-api
database of the affected environment:

```bash
npm run jobs:dead-letter -w packages/gp-api -- list
npm run jobs:dead-letter -w packages/gp-api -- redrive <job name> [job id]
npm run jobs:dead-letter -w packages/gp-api -- delete <job name> <job id>
```

`list` prints each dead job's data and the error from its last attempt.
`redrive` moves jobs back to their queue as fresh jobs with retries reset;
fix the cause first. `delete` drops one for good. Both also delete the
failed original in the job's own queue, which unblocks a strict-FIFO key.
The alert clears once the
dead-letter queues are empty. pg-boss deletes a dead job left untouched for
14 days (`retentionSeconds`), which also clears the alert.

## Metrics, dashboard and alerts

Every queue gets these with no code of its own. Each is labelled by queue,
and every task reports the same queue numbers, so read gauges with `max by`.

- **From pg-boss's OpenTelemetry** (label `messaging_destination_name`):
  `messaging_client_sent_messages_total` (jobs sent),
  `messaging_client_consumed_messages_total` (jobs picked up),
  `messaging_process_duration_seconds` (each attempt's run time; a failed
  attempt carries `error_type`), and `pgboss_queue_jobs` (jobs by
  `pgboss_job_state`, dead-letter queues included).
- **From JobsService** (label `queue`): `jobs_ready_oldest_seconds`, the age
  of the oldest ready job (pg-boss's `readyOldestSeconds`, recorded only with
  `persistQueueStats` on), and `jobs_max_wait_seconds`, the registry's
  `maxWaitMinutes`.
- **Dashboard:** "gp-api background jobs" in Grafana
  (`deploy/components/jobsDashboard.ts`): volume, failure rate, run time,
  state, oldest job and dead letters, per queue.
- **Alerts** (`deploy/components/alerting/job-alerts.ts`), one instance per
  queue: `jobs-backed-up` when the oldest ready job has waited past
  `maxWaitMinutes`, and `jobs-dead-letter` when a dead-letter queue holds a
  job.

## Scaling

Each task runs up to `localConcurrency` jobs per queue. Every task publishes
`QueuedJobs` (ready but not started) to CloudWatch, and prod autoscaling adds
tasks when the backlog per task passes its target
(`deploy/components/service.ts`). Jobs held back by `groupConcurrency` count
as queued, so one org with many waiting jobs can add tasks that cannot help
it. A job's `process` span continues the trace of the request that sent it.

## Schema and migrations

Prisma migrations own the `pgboss` schema; pg-boss runs with
`migrate: false` and `start()` throws if the installed schema is not the
version it expects. After installing or upgrading `pg-boss`:

```bash
npm run migrate:pg-boss -w packages/gp-api
```

It writes `prisma/schema/migrations/<ts>_pg_boss_v<N>/migration.sql` from
pg-boss's own SQL. Do not edit it. Prisma only diffs the `public` schema, so
`migrate diff` ignores `pgboss`. Read the pg-boss release notes before an
upgrade. A queue's `policy` cannot change in place; changing it means a new
queue name.

## Tests

`useTestService()` boots pg-boss against the suite's database with workers
off, so a sent job stays queued (query `pgboss.job`). `useTestService({ jobs:
true })` starts the workers; wait with
`app.get(JobsService).getSpy(name).waitForJob(selector, 'completed')`. The
per-test reset empties `pgboss.job`. To test the work directly, call the
service method the worker calls, with a plain `JobRun` object.

## Gotchas

- Every gp-api process connected to a database works its queues. Pointing a
  local gp-api at the shared dev database makes your laptop a dev worker.
- Each task holds its own pg pool for pg-boss: 10 connections, 3 on previews.
