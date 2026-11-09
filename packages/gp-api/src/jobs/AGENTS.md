# Jobs (pg-boss)

Background jobs on [pg-boss](https://pgboss.io): a job queue that lives in the
gp-api Postgres database, schema `pgboss`. Workers run inside every gp-api
task. New background work goes here, not on the SQS queue (`src/queue/`), and
so does new scheduled work (§ Schedules), not `@Cron`.

## Key files

| Path                           | Purpose                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `jobs.registry.ts`             | `JOBS` and `SCHEDULES`: every job and schedule, its worker and its few settings |
| `jobs.service.ts`              | `send()`, `sendMany()`, queue and schedule setup, workers, logging, metrics     |
| `jobs.module.ts`               | `@Global()`: any provider can inject `JobsService`                              |
| `scripts/pg-boss-migration.ts` | Writes the Prisma migration for the pgboss schema                               |
| `scripts/jobs-dead-letter.ts`  | Lists, redrives or deletes dead-lettered jobs                                   |
| `scripts/jobs-load-test.ts`    | Queues `jobsLoadTest` jobs to load-test job-driven autoscaling                  |

## Adding a job

Add an entry to `JOBS` in `jobs.registry.ts`, wrapped in `defineJob()` so the
worker's payload type comes from the schema:

```ts
myJob: defineJob({
  schema: z.object({ thingId: z.uuid() }),
  worker: (job, { get }) => get(ThingService).process(job),
  alertAfterWaitingMinutes: 10, // required
  timeoutMinutes: 15, // default 15: one attempt's limit
  attempts: 3, // default 3: tries in total, then dead-letter
  concurrency: 1, // default 1: jobs of this type per gp-api task
}),
```

That is the whole configuration. Everything else is the same for every
queue and set in `JobsService`: strict FIFO per group, retry backoff from 30
seconds to at most 10 minutes, a 60-second heartbeat, a dead-letter queue,
NOTIFY wake-ups, and the metrics, dashboard and alerts below.

- `schema`: identifiers only. Payloads are logged, so never put PII or a
  credential in one; pass an id and load the rest in the worker.
- `worker`: keep it thin, fetch the service that owns the work and call it.
  `get` reaches any provider in the app.
- `alertAfterWaitingMinutes`: when a job has waited this long to start,
  `jobs-backed-up` pages, and dev and prod add tasks from half of it
  (§ Scaling).
  Set it to the longest a user or a downstream step can wait.
- `concurrency`: per task. There is no fleet-wide cap; autoscaling adds
  tasks.

Only `jobs.module.ts` imports the registry at runtime. Workers import feature
services, and feature services import `JobsService`, so `jobs.service.ts`
imports it as types only and receives it through Nest. Keep it that way.

## Sending

```ts
await this.jobs.send('myJob', { thingId }, { group, tx })
```

- `send()` throws when the data fails its schema or the insert fails. Nothing
  is swallowed; let it propagate or handle it. It resolves to the job id.
- `group` (optional): jobs that share a group run one at a time, in the
  order they were sent (see § Ordering). Without one, a job runs whenever a
  worker is free.
- `tx` (optional): a client from `this.client.$transaction(async (tx) =>
...)`. The job commits or rolls back with your writes, so a row that says
  "queued" always has a job. Use it whenever a status change and a job go
  together (`contactUploads.service.ts` is the reference).

## Sending many (`sendMany`)

```ts
await this.jobs.sendMany(
  'myJob',
  things.map((thing) => ({
    data: { thingId: thing.id },
    key: `${thing.id}:${weekStart}`,
  })),
  { tx }, // optional
)
```

- `key` (required) names the item and the occurrence. The job id is a uuid
  derived from the job name and the key, so a retried fan-out inserts nothing
  for a job that is still in the queue. A finished job is deleted a minute
  later (§ Ordering), so after that the same key queues it again: the worker
  must still be safe to run twice.
- Every item is checked against the schema before anything is inserted.
  Two items with one key throw.
- Inserts run in chunks of 1,000. Without `tx` each chunk commits on its own;
  a retry fills in the rest.
- `group` per item works as on `send()`. One `jobs sent` log line per call,
  with the count and chunk count, not each payload.

## Schedules

A schedule runs a worker on a cron. Add an entry to `SCHEDULES` in
`jobs.registry.ts`, wrapped in `defineSchedule()`:

```ts
myDigest: defineSchedule({
  cron: '0 4 * * 1', // five fields, always UTC: minute precision
  worker: (_job, { get }) => get(MyDigestService).fanOut(),
  alertAfterWaitingMinutes: 30, // required, as on JOBS
  timeoutMinutes: 15, // default 15
  attempts: 3, // default 3
}),
```

- Each schedule gets its own queue, named by its key, set up exactly like a
  job's queue: retries, dead letters, metrics, dashboard and alerts. A
  schedule name must not also be a `JOBS` name; boot fails if one is.
- No payload. The worker gets a `JobRun` with empty `data` and reads what it
  needs when it runs. `send()` and `sendMany()` take only `JOBS` names.
- pg-boss checks schedules every 30 seconds and sends one job per
  occurrence, however many tasks are running. Minute precision only: a job
  that needs a seconds field stays on `@Cron` (`docs/scheduled-jobs.md`).
- Crons are always read in UTC; there is no time zone setting. Convert a
  local time yourself, and say in a comment what it is locally, since UTC
  does not move with daylight saving.
- Runs of one schedule share one group (the schedule's name), so they run
  one at a time: a slow run delays the next instead of overlapping it.
- Missed occurrences are skipped (`missed: 'skip'`): one that came due
  while no task was checking schedules (a full outage; a rolling deploy
  keeps checking) never runs late. The next occurrence does the work, so a
  schedule must not depend on every occurrence running.
- Synced with the code at boot: every task registers each `SCHEDULES` entry
  and removes any schedule in the database that is not one. Deleting an
  entry stops it; its queue stays.
- Logs: `schedule registered` and `schedule removed` at boot; each run is a
  job and logs like one (§ Logs).

**Every scheduled job must be safe to run twice.** A run can fail after doing
part of its work and be retried, and a worker that only looked dead can still
be running when its retry starts.

## Fan-out

A scheduled job that touches many records must not loop over them doing the
work. It finds the records and sends one job per record with `sendMany`,
keyed by the record and the occurrence (`${campaignId}:${windowStart}`), so
each record retries, dead-letters and alerts on its own and one failure
cannot stop the rest. The per-record job does the work.
`weeklyTasksDigest` and `weeklyTasksDigestCampaign` are the reference.

## Ordering

Every queue works like an SQS FIFO queue (pg-boss's `key_strict_fifo`):

- Jobs in one group run strictly in send order, one at a time across every
  task. A job waiting on a retry holds its group: nothing behind it runs
  until it completes or dead-letters.
- Different groups never wait on each other. A job sent without a group is
  its own group.
- After a job dead-letters, its group moves on within about two minutes.
  pg-boss holds a group while it has a failed job, so finished jobs are
  deleted from `pgboss.job` after a minute and cleanup runs every minute.
  The record of a job is its log lines (§ Logs) and, for a dead letter, its
  dead-letter copy.

Group by the thing whose work must not overlap or reorder, usually an org
slug (contact imports group by org). Prefer no group: a group serializes work, and a slow job holds up
everything behind it in its group.

## Workers

- Workers must be retry-safe and idempotent: running a job twice, or
  resuming after an attempt died halfway, must leave the same result. A task
  can die mid-job, a deploy stops every task, and a worker that only looked
  dead can still be running when its retry starts.
- Return to complete the job. Throw to fail the attempt; it retries until
  `attempts` is spent, then the job is dead-lettered.
- `job.retryCount >= job.retryLimit` is the last attempt. Use it to record a
  user-visible failure before throwing.
- **Shutdown.** On SIGTERM a task stops taking jobs and gives running ones
  20 seconds to finish (ECS kills it at 30). After that `job.signal` aborts
  and the attempt fails and retries on another task, which spends an
  attempt. A task that dies without SIGTERM is caught by the heartbeat, and
  its job retries within about two minutes. So a job that can run longer
  than 20 seconds must check `job.signal.aborted` at safe points, throw,
  and resume on the retry, and needs `attempts` headroom for deploys.

## Payload changes

Old and new code run side by side during a deploy, and both work the same
queues. A payload change must be readable by the previous release: add
fields as optional, never rename or remove one in the same release that
starts sending the new shape.

## Logs

`JobsService` logs every step of every job, under the `JobsService`
context, with `job`, `jobId`, `group`, and `attempt`/`attempts`:

| Message                          | Also carries                |
| -------------------------------- | --------------------------- |
| `job sent`                       | `data`, `inTransaction`     |
| `jobs sent` (`sendMany`)         | `count`, `chunks`; no id    |
| `job started`                    | `waitedSeconds`             |
| `job completed`                  | `durationMs`                |
| `job attempt failed; will retry` | `err`, `durationMs`         |
| `job dead-lettered`              | `err`, `durationMs`, `data` |

To rebuild a job's history, search Loki for its `jobId`. An attempt lost to
a crash, a stale heartbeat, the timeout or a shutdown never reaches the
worker's error handling: it shows as a `job started` with no outcome,
followed by the next attempt's `job started`. A `job sent` with
`inTransaction: true` and no `job started` may be a send whose transaction
rolled back.

## Metrics, dashboard and alerts

Every queue gets these with no code of its own. Each is labelled by queue,
and every task reports the same queue numbers, so read gauges with `max by`.

- **From pg-boss's OpenTelemetry** (label `messaging_destination_name`):
  `messaging_client_sent_messages_total` (jobs sent),
  `messaging_client_consumed_messages_total` (jobs picked up),
  `messaging_process_duration_seconds` (each attempt's run time; a failed
  attempt carries `error_type`), and `pgboss_queue_jobs` (jobs by
  `pgboss_job_state`, dead-letter queues included). A job's `process` span
  continues the trace of the request that sent it.
- **From JobsService** (label `queue`): `jobs_ready_oldest_seconds`, how long
  the oldest ready job has waited (pg-boss's `readyOldestSeconds`, recorded
  only with `persistQueueStats` on), and `jobs_max_wait_seconds`, the
  registry's `alertAfterWaitingMinutes`, and `jobs_wait_pressure`, the
  number dev and prod scale on (§ Scaling; dev and prod only).
- **Dashboard:** "gp-api {env} - background jobs" in Grafana
  (`deploy/components/jobsDashboard.ts`): volume, failure rate, run time,
  state, oldest job, dead letters and wait pressure, per queue.
- **Alerts** (`deploy/components/alerting/job-alerts.ts`), one instance per
  queue: `jobs-backed-up` when the oldest ready job has waited past
  `alertAfterWaitingMinutes`, and `jobs-dead-letter` when a dead-letter
  queue holds a job.

## Dead letters

Every job's queue has a dead-letter queue, `<name>-dlq`, that no worker
reads. A dead letter keeps the job's payload and last error for 14 days.
Handle one with `scripts/jobs-dead-letter.ts`, with `DATABASE_URL` set to the
gp-api database of the affected environment:

```bash
npm run jobs:dead-letter -w packages/gp-api -- list
npm run jobs:dead-letter -w packages/gp-api -- redrive <job name> [job id]
npm run jobs:dead-letter -w packages/gp-api -- delete <job name> <job id>
```

`list` prints each dead job's data and the error from its last attempt.
`redrive` moves jobs back to their queue as fresh jobs with attempts reset,
at the back of their group; fix the cause first. `delete` drops one for
good. The alert clears once the dead-letter queues are empty, or when a dead
job is deleted after 14 days untouched.

## Scaling

Dev and prod scale out on **wait pressure**: per queue, how long the oldest
job a free worker could start has waited, divided by its
`alertAfterWaitingMinutes`; the highest queue wins, and 0 means nothing
waits. A job count would be the wrong unit: 5 waiting 2-hour jobs are a
backlog, 5 waiting 50ms jobs are nothing.

- **Claimable jobs only.** A job behind an active, retrying or failed job
  of its group cannot start on a new task, so it does not count. The query
  in `refreshWaitPressure()` picks each group's head the way pg-boss's
  fetch does (`job_i10`). pg-boss's `readyOldestSeconds` counts held jobs,
  which is why the alert and the scaling can disagree.
- **Where.** On dev and prod, every task runs the query once a minute and
  publishes the result to CloudWatch (`GpApi/Jobs` `JobWaitPressure`,
  dimension `Environment`), because ECS autoscaling can only read
  CloudWatch, and as the `jobs_wait_pressure` gauge.
- **Target tracking** (`deploy/components/service.ts`, dev and prod):
  policy `gp-api-<env>-job-wait-tracking` tracks the maximum of its own
  environment's metric at 0.5, so tasks are added before a job has used
  half its allowed wait, up to 24 on prod and 6 on dev. Scale-out
  cooldown 1 minute, scale-in cooldown 10 minutes.
- **Scale-in veto.** AWS scales out when any target-tracking policy asks
  and scales in only when all of them agree. Jobs wait on I/O, so CPU and
  memory read idle during a backlog and want to remove tasks; while
  pressure is above target this policy says no. A step policy has no vote,
  so CPU and memory removed each task it added (ADR
  `2026-11-09-job-wait-pressure-scales-by-target-tracking.md`). Pressure
  is 0 most of the time, which counts as ready to scale in, so CPU and
  memory decide scale-in then.
- **Overshoot.** Target tracking sizes scale-out as if the metric fell in
  proportion to tasks added. Wait time does not, so a burst can scale to
  the cap before pressure drops. Accepted; the cap bounds the cost.
- **Needs data.** With no data points the policy's alarms go
  `INSUFFICIENT_DATA` and it does not act until data returns. Every dev and
  prod task publishes once a minute, so that means publishing broke.
- **Stuck workers.** Workers that stop taking jobs make pressure climb, and
  scaling runs to the cap (24 prod, 6 dev) without helping.
  `jobs-backed-up` and `jobs-dead-letter` still page.

### Load-testing it on dev

`jobsLoadTest` jobs only sleep, one per task at a time, and each is its own
group, so a backlog of them is pressure any new task can relieve.
`scripts/jobs-load-test.ts` queues them straight into the database, so it
needs the VPN and dev's `DATABASE_URL`, built from the dev database secret
(`GP_API_DEV`). 30 jobs of 60 seconds:

```bash
DATABASE_URL=<dev> npm run jobs:load-test -w packages/gp-api -- 30 60
```

The queue allows 2 minutes of waiting, so pressure passes 0.5 a minute in.
Watch the wait-pressure panel on "gp-api dev - background jobs" and the dev
service's desired count in ECS: it should climb from 2 toward 6 within a
few minutes, and drift back to 2 once the queue drains and all three
policies agree to scale in (15 minutes or more). `jobs-backed-up` fires on
dev for `jobsLoadTest` while the backlog lasts; that is expected. The script
refuses a prod database unless given `--allow-prod`, because there the same
alert pages and the jobs add prod tasks for real.

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
upgrade.

## Tests

**Test a job at the edge, as you would a route.** Drive the real trigger,
let the real workers run inside the test app, and assert on outcomes:
database rows, Segment events, vendor calls. Never call the worker's service
method with a hand-built `JobRun`: that tests which method a worker happens
to call, and skips the schema, retries and fan-out.

`useTestService({ jobs: true })` starts the workers and gives the test
`service.jobs` (`src/test-service.ts`):

- `settle({ timeoutMs?, allowDeadLetters? })` waits until no job in our
  queues is queued, retrying or running, including jobs those jobs sent.
  It throws on a dead letter, naming the job, its data and its last error,
  unless `allowDeadLetters` is set; then it returns
  `{ deadLetters: [{ name, data, error }] }`. On a timeout (default 20s) it
  throws naming every unfinished job.
- `runSchedule(name, options?)` queues one run of a `SCHEDULES` entry
  exactly as its cron would, then `settle(options)`.

Event-driven work: call the route that sends the job, then settle
(`contactUploads/tests/contactUploadProcess.jobs.test.ts`):

```ts
await service.client.post(`/v1/contact-uploads/${uploadId}/uploaded`)
await service.jobs.settle()
const upload = await service.prisma.contactUpload.findUniqueOrThrow({
  where: { id: uploadId },
})
expect(upload.status).toBe(ContactUploadStatus.complete)
```

Scheduled work: seed the data, run the schedule, assert what it and its
fan-out did (`weeklyTasksDigestHandler.service.integration.test.ts` in
`campaigns/tasks/services/`). To pick the time it runs at, fake only
`Date`: `vi.useFakeTimers({ toFake: ['Date'], now })`.

```ts
const track = vi.spyOn(service.app.get(AnalyticsService), 'track')
track.mockResolvedValue({ event: 'tracked', userId: 'tracked' })
await service.jobs.runSchedule('weeklyTasksDigest')
expect(track).toHaveBeenCalledTimes(2) // one per eligible campaign
```

Failure: make a dependency fail with `vi.spyOn`, and assert both the dead
letter and that the rest of the work still happened:

```ts
track.mockImplementation(async (userId, event) => {
  if (userId === failing.userId) throw new Error('Segment down')
  return { event, userId: String(userId) }
})
const { deadLetters } = await service.jobs.runSchedule('weeklyTasksDigest', {
  allowDeadLetters: true,
})
expect(deadLetters).toEqual([
  {
    name: 'weeklyTasksDigestCampaign',
    data: { campaignId: failing.id, windowStart, windowEnd },
    error: 'Segment down',
  },
])
```

Under `NODE_ENV=test` a retry starts at once (no delay, no backoff), so a
job goes through every attempt to its dead letter in a few seconds.
Production keeps the backoff. The per-test reset empties `pgboss.job`,
dead letters included, so no job or dead letter reaches the next test.

Don't:

- Call a worker's service method (`process(job)`, `sendCampaignDigest(job)`)
  with a hand-built `JobRun` to test what the job does. Existing tests that
  do, such as the direct
  `process()` calls in `contactUploads.routes.test.ts`, are a pattern to
  migrate when you next touch that file.
- Assert on `pgboss.job` rows instead of outcomes. Only tests of the job
  system itself (`jobs.test.ts`) read them.
- Wait with `app.get(JobsService).getSpy(name)`. It still works, but it
  waits on one job and misses what that job sent; prefer `settle()`.

Pure logic a worker uses (building an event's properties, grouping rows) can
still be unit-tested with mocks; that tests the logic, not the job. With `useTestService()` (workers off) a sent job
stays queued, and `service.jobs` throws, saying it needs `{ jobs: true }`.

Schedules never fire on their cron in tests (pg-boss's `schedule` is off);
`runSchedule()` is how a test runs one. `jobs.test.ts` drives the real cron
pass on a pg-boss `TestClock` with two instances, which is how to prove a
schedule change sends one job per occurrence.

## Gotchas

- Every gp-api process connected to a database works its queues. Pointing a
  local gp-api at the shared dev database makes your laptop a dev worker.
- Each task holds its own pg pool for pg-boss: 10 connections, 3 on
  previews, plus one held open for NOTIFY.
