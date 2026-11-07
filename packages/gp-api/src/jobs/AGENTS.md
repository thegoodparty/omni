# Jobs (pg-boss)

Background jobs on [pg-boss](https://pgboss.io): a job queue that lives in the
gp-api Postgres database, schema `pgboss`. Workers run inside every gp-api
task. New background work goes here, not on the SQS queue (`src/queue/`).

## Key files

| Path                           | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `jobs.registry.ts`             | `JOBS`: every job's payload schema (Zod), queue options, worker options |
| `jobs.workers.ts`              | `WORKERS`: the one worker for each job                                  |
| `jobs.service.ts`              | `send()`, queue setup, the autoscaling metric to CloudWatch             |
| `jobWorkers.service.ts`        | Starts `WORKERS` on every task                                          |
| `jobs.module.ts`               | `@Global()`: any provider can inject `JobsService`                      |
| `scripts/pg-boss-migration.ts` | Writes the Prisma migration for the pgboss schema                       |
| `scripts/jobs-dead-letter.ts`  | Lists, redrives or deletes dead-lettered jobs                           |

## Adding a job

1. Add an entry to `JOBS` in `jobs.registry.ts`: `schema` (Zod),
   `queue` (retries, backoff, `expireInSeconds`), `work`
   (`localConcurrency`, and `groupConcurrency` if jobs that share a group
   must not run at once).
2. Add its worker to `WORKERS` in `jobs.workers.ts`:
   `(job, { get }) => get(SomeService).doTheWork(job)`. `get` reaches any
   provider in the app. The map's type requires exactly one worker per job,
   so a missing or second worker is a type error.
3. Send it: `await this.jobs.send('<name>', data, options)`.

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
  group run at once, across every task (per-org serial work: group by org
  slug). Groups limit concurrency; they do not guarantee order. A job waiting
  on a retry can be overtaken by a later job in its group.
- `singletonKey`, `startAfter`, `priority`: see the pg-boss `send()` docs.

## Workers

- Keep the worker thin: fetch the service that owns the work and call it.
- Return to complete the job. Throw to fail it: pg-boss retries up to
  `retryLimit`, then moves it to the job's dead-letter queue.
- Workers must be safe to run more than once. A task can die mid-job, and a
  deploy stops every task.
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
reads. The `jobs-dead-letter` alert fires while any dead-letter queue holds a
job (`pgboss_queue_jobs` in Grafana, prod). Handle one with
`scripts/jobs-dead-letter.ts`, with
`DATABASE_URL` set to the affected database (root `CLAUDE.md` data access
recipes):

```bash
npm run jobs:dead-letter -w packages/gp-api -- list
npm run jobs:dead-letter -w packages/gp-api -- redrive <job name> [job id]
npm run jobs:dead-letter -w packages/gp-api -- delete <job name> <job id>
```

`list` prints each dead job's data and the error from its last attempt.
`redrive` moves jobs back to their queue as fresh jobs with retries reset;
fix the cause first. `delete` drops one for good. The alert clears once the
dead-letter queues are empty. pg-boss deletes a dead job left untouched for
14 days (`retentionSeconds`), which also clears the alert.

## Scaling

Each task runs up to `localConcurrency` jobs per queue. Every task publishes
`QueuedJobs` (ready but not started) to CloudWatch, and prod autoscaling adds
tasks when the backlog per task passes its target
(`deploy/components/service.ts`). Jobs held back by `groupConcurrency` count
as queued, so one org with many waiting jobs can add tasks that cannot help
it. OpenTelemetry spans and metrics
(`pgboss.queue.jobs`, `messaging.process.duration`) go to Grafana; a job's
`process` span continues the trace of the request that sent it.

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
