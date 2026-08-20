# Scheduled jobs

How to add a recurring job in gp-api without it running twice. Prod runs **two
gp-api replicas** (`desiredCount: isProd ? 2 : 1`,
`packages/gp-api/deploy/components/service.ts`), and `@nestjs/schedule` is
in-process: every replica has its own scheduler. Nothing dedupes for you.

## Never use `@Interval` for work that must run once

`@Interval(ms)` is a `setInterval` on each replica. Two consequences:

- **It fires N times per tick**, once per replica, with no coordination.
- **Its phase resets on every deploy.** A daily `@Interval` on a service that
  deploys most weekdays effectively never fires; an hourly one drifts to a new
  offset after each release.

Use **`@Cron`** with an explicit `timeZone` instead. A fixed wall-clock schedule
survives deploys and — because every replica fires at the same instant — makes
slot-keyed dedup possible.

```ts
@Cron('23 * * * *', { name: 'myJob', timeZone: EASTERN_TIMEZONE })
```

`EASTERN_TIMEZONE` lives in `src/shared/util/date.util.ts`. Pass it (or another
explicit zone) rather than relying on container TZ.

`@Interval` is still fine for work that is _idempotent per record_ — a sweep
whose every unit is behind an atomic DB claim, so a duplicate pass is a no-op.
`sweepStrandedAgenticKickoffs` is the reference case: its claim on
`kickoffSentAt` means a second concurrent pass writes nothing.

## Pick a non-`:00` minute

Most existing jobs sit on the hour, so `0 * * * *` puts your job in a thundering
herd against them (and against every other service's on-the-hour work). Pick an
offset minute — `23 * * * *`, `*/10 * * * *`, `0 10 * * *` when the hour itself
is the spacing knob. `grep -rn '@Cron(' packages/gp-api/src` before choosing.

## The two dedup mechanisms in use

### `CronLockService` — durable DB claim

`src/cron/services/cronLock.service.ts`. Inserts a row into `cron_run` keyed on
`(jobName, runDate)`, where `runDate` is the **start of the run slot in UTC**.
The unique constraint is the lock: the first insert wins, the losers get a
unique violation and skip. Durable and pooling-safe — unlike a session advisory
lock it cannot leak and block a future slot.

| Slot     | Claim               | Complete              | Stale window |
| -------- | ------------------- | --------------------- | ------------ |
| UTC day  | `tryClaimDailyRun`  | `markCompleted`       | 6h           |
| UTC hour | `tryClaimHourlyRun` | `markHourlyCompleted` | 30m          |

**Match the claim to the schedule.** Wrapping a sub-daily `@Cron` in
`tryClaimDailyRun` silently throttles it to one run per UTC day — the extra
firings are all denied, and nothing logs an error.

Best for **self-contained** jobs: the whole pass runs inline in the winning
replica.

### SQS FIFO `deduplicationId` — slot-keyed enqueue

Every replica enqueues, SQS collapses the duplicates, one consumer runs the
work. Used by `cvStatusPoll.service.ts`, `nightly10DlcReport.service.ts`, and
`bootstrapTcrComplianceCheck`. The dedup key is a formatted slot:

```ts
const slot = formatInTimeZone(new Date(), EASTERN_TIMEZONE, 'yyyy-MM-dd-HH')
// deduplicationId: `tcrStatusCheck-${record.id}-${slot}`
```

Best when the work **already belongs on the queue** (it needs a consumer's
retry/DLQ behavior, or it fans out per record).

**Its constraint:** SQS FIFO dedup only holds inside a **5-minute window**. It
works here only because every replica's `@Cron` fires on the same instant, so
all the duplicate enqueues land within seconds of each other. If replicas ever
drifted more than 5 minutes apart — a clock-skewed host, a schedule derived from
boot time — the dedup would **fail silently** and the job would run twice. That
is the reason `@Interval` was wrong for these: its phase is boot-relative, so
replicas drift by construction.

## Stale-claim takeover, and why `markCompleted` matters

A `cron_run` row whose `completedAt` is still null past the stale window is
assumed to belong to a crashed replica, and the claim is atomically taken over
so the slot is retried instead of silently lost. `createdAt` doubles as the
claim timestamp and is refreshed on takeover, so two concurrent takeovers can't
both win.

That only works if healthy runs seal their claim. **Call the completion method
in a `finally`**, so a pass that throws partway still marks the slot done — an
unsealed claim blocks nothing forever, but it does leave the slot eligible for a
pointless takeover-retry inside the same window.

Choose the stale window to comfortably exceed the longest _legitimate_ run. The
6h daily window is sized for the meeting-briefings loop (batched with 20-minute
sleeps). Don't reuse a long window for a short slot: 6h spans six hourly slots.

## Prod-only guard

Jobs that spend money or hit a vendor rate limit return early off prod:

```ts
if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
  return
}
```

See `cvStatusPoll.triggerScan`. The reason is that dev/qa would make real vendor
calls against their own queues, and every call counts against the budget the job
exists to respect. Non-prod vendor flows are stubbed anyway, so there is nothing
meaningful to do. Some jobs use a feature-flag gate instead
(`isAutomationEnabled()` in `meetingBriefings` / `ordinanceDispatch`) — pick
whichever the surrounding feature already uses.

## Worked example

```ts
const SWEEP_CRON = '23 * * * *'
const SWEEP_JOB = 'tcrUnsubmittedUsecaseSweep'

@Cron(SWEEP_CRON, { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
async sweepUnsubmittedUsecases() {
  // Pin one timestamp so claim and completion resolve to the same slot even
  // if the pass crosses the hour boundary.
  const now = new Date()
  if (!(await this.cronLock.tryClaimHourlyRun(SWEEP_JOB, now))) return

  try {
    for (const record of await this.selectCandidates()) {
      try {
        await this.process(record)
      } catch (err) {
        // Per-record isolation: one bad record must not abort the pass.
        this.logger.error({ err, id: record.id }, 'record failed; continuing')
      }
    }
  } finally {
    await this.cronLock.markHourlyCompleted(SWEEP_JOB, now)
  }
}
```

The enclosing module must import `CronModule` (`src/cron/cron.module.ts`) to
inject `CronLockService`.

## Checklist for a new job

- [ ] `@Cron`, not `@Interval` — unless every unit of work has its own atomic
      record-level claim.
- [ ] Explicit `timeZone`, and a `name` so it is identifiable in logs.
- [ ] A non-`:00` minute that doesn't collide with an existing job.
- [ ] A dedup mechanism: `CronLockService` at the right slot width, or a
      slot-keyed FIFO `deduplicationId`.
- [ ] Completion marked in a `finally`.
- [ ] Per-record `try`/`catch` inside the loop.
- [ ] Prod-only guard (or the feature's automation flag) if it spends money or
      hits a vendor.
- [ ] A test that two invocations in the same slot produce **one** execution.
      `communityIssues/services/communityIssueDispatch.service.test.ts` shows
      how callers fake the lock;
      `cron/services/cronLock.service.test.ts` covers the real Postgres race.
