import { Injectable } from '@nestjs/common'
import { subMilliseconds } from 'date-fns'
import ms from 'ms'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { getMidnightForDate, getUtcHourStart } from '@/shared/util/date.util'

// A claim that is still incomplete after this long is assumed to belong to a
// crashed run and may be taken over. Must comfortably exceed the longest a
// guarded job can legitimately run (the daily briefings loop batches with
// 20-minute sleeps and can take a few hours).
const DAILY_STALE_CLAIM_MS = ms('6h')

// Hourly jobs get their own, much shorter window: the daily 6h would leave a
// crashed run's claim blocking six subsequent cycles, and no hourly job here
// runs anywhere near this long (the Peerly sweeps pace ~350ms per record).
const HOURLY_STALE_CLAIM_MS = ms('30m')

@Injectable()
export class CronLockService extends createPrismaBase(MODELS.CronRun) {
  /**
   * Claims the once-per-day run slot for `jobName`. Returns `true` if this
   * process won the claim and should run the job, `false` if another process
   * (e.g. a second ECS replica firing the same @Cron) already holds an active
   * or completed claim for the same UTC calendar date.
   *
   * Callers must invoke {@link markCompleted} once the job finishes.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async tryClaimDailyRun(
    jobName: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.claimSlot(
      jobName,
      getMidnightForDate(now),
      now,
      DAILY_STALE_CLAIM_MS,
    )
  }

  /**
   * Claims the once-per-hour run slot for `jobName`, keyed to the start of the
   * UTC hour containing `now`. Same lock as {@link tryClaimDailyRun} one period
   * down: an hourly @Cron firing on every replica collapses to a single
   * cluster-wide execution per hour, and the next hour is a distinct key so the
   * cadence stays hourly.
   *
   * Callers must invoke {@link markHourlyCompleted} once the job finishes.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async tryClaimHourlyRun(
    jobName: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.claimSlot(
      jobName,
      getUtcHourStart(now),
      now,
      HOURLY_STALE_CLAIM_MS,
    )
  }

  /**
   * Marks the current UTC day's claim for `jobName` as completed, so a later
   * invocation will not treat it as a crashed run and take it over.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async markCompleted(jobName: string, now: Date = new Date()): Promise<void> {
    await this.completeSlot(jobName, getMidnightForDate(now), now)
  }

  /**
   * Marks the current UTC hour's claim for `jobName` as completed.
   *
   * @param now Defaults to the current time; injectable for tests.
   */
  async markHourlyCompleted(
    jobName: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.completeSlot(jobName, getUtcHourStart(now), now)
  }

  /**
   * The `(jobName, runDate)` unique constraint is the lock: the first insert
   * wins, concurrent inserts get a unique violation. This is durable and
   * pooling-safe — unlike a session advisory lock it cannot leak and block a
   * future slot's run.
   *
   * If a prior claim is still incomplete past `staleClaimMs` the claimer is
   * assumed to have crashed, and the claim is atomically taken over so the job
   * can be retried instead of silently lost.
   */
  private async claimSlot(
    jobName: string,
    runDate: Date,
    now: Date,
    staleClaimMs: number,
  ): Promise<boolean> {
    try {
      // createdAt doubles as the claim timestamp for staleness checks, so set it
      // explicitly rather than relying on the DB default.
      await this.model.create({ data: { jobName, runDate, createdAt: now } })
      this.logger.info({ jobName, runDate }, 'claimed cron run slot')
      return true
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err

      // A row already exists. Take it over only if it never completed and its
      // claim is stale — refreshing createdAt so concurrent takeovers can't
      // both win (the conditional update matches at most one row).
      const cutoff = subMilliseconds(now, staleClaimMs)
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
        'cron run slot already claimed by another instance; skipping',
      )
      return false
    }
  }

  private async completeSlot(
    jobName: string,
    runDate: Date,
    now: Date,
  ): Promise<void> {
    await this.model.updateMany({
      where: { jobName, runDate },
      data: { completedAt: now },
    })
  }
}
