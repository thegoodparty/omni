import { Injectable } from '@nestjs/common'
import { subMilliseconds } from 'date-fns'
import ms from 'ms'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { getMidnightForDate } from '@/shared/util/date.util'

// A daily claim that is still incomplete after this long is assumed to belong
// to a crashed run and may be taken over. Must comfortably exceed the longest a
// guarded job can legitimately run (the daily briefings loop batches with
// 20-minute sleeps and can take a few hours).
const STALE_CLAIM_MS = ms('6h')

// Hourly claims get their own, much shorter window: the 6h daily window spans
// six hourly slots, so an incomplete claim would keep being honoured long
// after its slot closed. 30 minutes is half a slot — comfortably longer than a
// legitimate hourly pass (a few vendor calls per record), so a slow pass is
// never double-claimed, and short enough that a crashed claim never outlives
// its own hour. Recovery does not depend on this window: the next hour is a
// new slot key, so a crashed pass retries within the hour regardless.
const STALE_HOURLY_CLAIM_MS = ms('30m')

// Start of the UTC hour containing `date`. Built from the UTC components for
// the same reason getMidnightForDate is: date-fns' startOfHour works in local
// time, so a zone with a sub-hour offset would land on a different slot than
// its peers.
const getUtcHourStart = (date: Date) =>
  new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    ),
  )

@Injectable()
export class CronLockService extends createPrismaBase(MODELS.CronRun) {
  /**
   * Claims the once-per-day run slot for `jobName`. Returns `true` if this
   * process won the claim and should run the job, `false` if another process
   * (e.g. a second ECS replica firing the same @Cron) already holds an active
   * or completed claim for the same UTC calendar date.
   *
   * The `(jobName, runDate)` unique constraint is the lock: the first insert
   * wins, concurrent inserts get a unique violation. This is durable and
   * pooling-safe — unlike a session advisory lock it cannot leak and block a
   * future day's run.
   *
   * If a prior claim is still incomplete past {@link STALE_CLAIM_MS} the
   * claimer is assumed to have crashed, and the claim is atomically taken over
   * so the job can be retried instead of silently lost for the day. Callers
   * must invoke {@link markCompleted} once the job finishes.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async tryClaimDailyRun(
    jobName: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    // The lock key is the UTC calendar date only: getMidnightForDate zeroes the
    // time, so two replicas whose `now` differ by a fraction of a second still
    // collapse to the same runDate and collide on the unique
    // (jobName, runDate) constraint. `now` keeps its time because createdAt
    // uses it as the claim timestamp for staleness/takeover.
    return this.tryClaim(jobName, getMidnightForDate(now), now, STALE_CLAIM_MS)
  }

  /**
   * Claims the once-per-hour run slot for `jobName`, keyed on the start of the
   * UTC hour containing `now`. Same lock and takeover mechanics as
   * {@link tryClaimDailyRun}, with the shorter
   * {@link STALE_HOURLY_CLAIM_MS} staleness window.
   *
   * Use this — not `tryClaimDailyRun` — for a job scheduled more often than
   * daily: `tryClaimDailyRun` would silently throttle it to one run per UTC
   * day. Callers must invoke {@link markHourlyCompleted} once the job
   * finishes.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async tryClaimHourlyRun(
    jobName: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.tryClaim(
      jobName,
      getUtcHourStart(now),
      now,
      STALE_HOURLY_CLAIM_MS,
    )
  }

  /**
   * Marks the current UTC day's claim for `jobName` as completed, so a later
   * invocation will not treat it as a crashed run and take it over.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async markCompleted(jobName: string, now: Date = new Date()): Promise<void> {
    await this.model.updateMany({
      where: { jobName, runDate: getMidnightForDate(now) },
      data: { completedAt: now },
    })
  }

  /**
   * Marks the current UTC hour's claim for `jobName` as completed. The hourly
   * counterpart of {@link markCompleted}.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async markHourlyCompleted(
    jobName: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.model.updateMany({
      where: { jobName, runDate: getUtcHourStart(now) },
      data: { completedAt: now },
    })
  }

  // Shared claim mechanics for every slot width. `runDate` is the slot key
  // (already truncated by the caller); `staleMs` is how long an incomplete
  // claim is honoured before it is treated as a crashed run.
  private async tryClaim(
    jobName: string,
    runDate: Date,
    now: Date,
    staleMs: number,
  ): Promise<boolean> {
    try {
      // createdAt doubles as the claim timestamp for staleness checks, so set it
      // explicitly rather than relying on the DB default.
      await this.model.create({ data: { jobName, runDate, createdAt: now } })
      this.logger.info({ jobName, runDate }, 'claimed cron run')
      return true
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err

      // A row already exists. Take it over only if it never completed and its
      // claim is stale — refreshing createdAt so concurrent takeovers can't
      // both win (the conditional update matches at most one row).
      const cutoff = subMilliseconds(now, staleMs)
      const { count } = await this.model.updateMany({
        where: {
          jobName,
          runDate,
          completedAt: null,
          createdAt: { lt: cutoff },
        },
        data: { createdAt: now },
      })

      if (count > 0) {
        this.logger.warn(
          { jobName, runDate },
          'took over stale cron run claim (previous run never completed)',
        )
        return true
      }

      this.logger.info(
        { jobName, runDate },
        'cron run already claimed by another instance; skipping',
      )
      return false
    }
  }
}
