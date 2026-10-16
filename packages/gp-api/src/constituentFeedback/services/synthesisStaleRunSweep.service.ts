import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { HttpException, HttpStatus } from '@nestjs/common'
import { SynthesisRunStatus, SynthesisScope } from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { FeedbackSynthesisService } from './feedbackSynthesis.service'

const SWEEP_JOB = 'feedbackSynthesisStaleRuns'

const EXPECTED_REPOOL_REFUSALS: ReadonlySet<number> = new Set([
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
])

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
  constructor(
    private readonly cronLock: CronLockService,
    private readonly synthesis: FeedbackSynthesisService,
  ) {
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
      await this.repoolOwedPriorities()
    } finally {
      await this.cronLock.markTenMinuteCompleted(SWEEP_JOB, now)
    }
  }

  // A send that finished while its priority's pooled run was in flight
  // marked that run owed. Once the run is done, pool again so the send's
  // answers reach the priority's themes.
  private async repoolOwedPriorities(): Promise<void> {
    const owed = await this.model.findMany({
      where: {
        scope: SynthesisScope.priority,
        repoolOwed: true,
        status: { not: SynthesisRunStatus.running },
        priorityId: { not: null },
      },
      select: { id: true, organizationSlug: true, priorityId: true },
    })
    // The flag clears only once the re-pool is settled, so a failure that
    // throws anywhere leaves it owed for the next sweep. The cron lock keeps
    // two sweeps from starting it twice.
    for (const run of owed) {
      if (run.priorityId === null) continue
      const settled = await this.synthesis
        .requestPriorityRun({
          organizationSlug: run.organizationSlug,
          priorityId: run.priorityId,
          requestedByUserId: null,
        })
        .then(
          () => true,
          (err: Error) => {
            // A conflict re-marks the run now in flight; under the floor
            // there is nothing to pool.
            if (
              err instanceof HttpException &&
              EXPECTED_REPOOL_REFUSALS.has(err.getStatus())
            ) {
              return true
            }
            this.logger.error(
              { err, runId: run.id, priorityId: run.priorityId },
              'Owed priority re-pool failed',
            )
            return false
          },
        )
      if (settled) {
        await this.model.update({
          where: { id: run.id },
          data: { repoolOwed: false },
        })
      }
    }
  }
}
