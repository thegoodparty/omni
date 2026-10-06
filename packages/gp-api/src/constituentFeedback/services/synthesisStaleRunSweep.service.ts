import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { SynthesisRunStatus } from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'

const SWEEP_JOB = 'feedbackSynthesisStaleRuns'

// A pipeline run takes minutes. One that has not reported back in thirty
// lost its completion event, or its engine died mid-run.
const STALE_AFTER_MINUTES = 30

// Fails runs whose completion never arrived, which frees the scope's
// activeKey so the report offers the button again. The previous run's
// themes stay live throughout: only a completed run supersedes anything.
@Injectable()
export class SynthesisStaleRunSweepService extends createPrismaBase(
  MODELS.FeedbackSynthesisRun,
) {
  constructor(private readonly cronLock: CronLockService) {
    super()
  }

  // No deploy allowlist: the pass is one update against this deploy's own
  // database, with no vendor call to stampede. The lock stops prod's two
  // replicas both running it.
  @Cron('*/10 * * * *', { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepStaleRuns(): Promise<void> {
    await this.sweep(new Date())
  }

  // Separate from the @Cron method, which the scheduler calls with its own
  // arguments, so a test can pin the slot.
  async sweep(now: Date): Promise<void> {
    if (!(await this.cronLock.tryClaimTenMinuteRun(SWEEP_JOB, now))) return

    try {
      const { count } = await this.model.updateMany({
        where: {
          status: SynthesisRunStatus.running,
          createdAt: { lt: subMinutes(now, STALE_AFTER_MINUTES) },
        },
        data: {
          status: SynthesisRunStatus.failed,
          error: 'timeout',
          activeKey: null,
        },
      })
      if (count > 0) {
        this.logger.warn({ count }, 'Failed stale feedback synthesis runs')
      }
    } finally {
      await this.cronLock.markTenMinuteCompleted(SWEEP_JOB, now)
    }
  }
}
