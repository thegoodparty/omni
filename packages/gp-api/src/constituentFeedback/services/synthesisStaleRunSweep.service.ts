import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { subMinutes } from 'date-fns'
import { Prisma, SynthesisRunStatus, SynthesisScope } from '@/generated/prisma'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { FeedbackSynthesisService } from './feedbackSynthesis.service'

const EXPECTED_REPOOL_REFUSALS: ReadonlySet<number> = new Set([
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
])

// A pipeline run takes minutes. One that has not reported back in thirty
// lost its completion event, or its engine died mid-run.
const STALE_AFTER_MINUTES = 30

const OWED_REPOOL_WHERE = {
  scope: SynthesisScope.priority,
  repoolOwed: true,
  status: { not: SynthesisRunStatus.running },
  priorityId: { not: null },
} satisfies Prisma.FeedbackSynthesisRunWhereInput

// Fails runs whose completion never arrived, which frees the scope's
// activeKey so the report offers the button again. The previous run's
// themes stay live throughout: only a completed run supersedes anything.
@Injectable()
export class SynthesisStaleRunSweepService extends createPrismaBase(
  MODELS.FeedbackSynthesisRun,
) {
  constructor(
    private readonly jobs: JobsService,
    private readonly synthesis: FeedbackSynthesisService,
  ) {
    super()
  }

  // The feedbackSynthesisStaleRuns schedule's worker
  // (src/jobs/jobs.registry.ts). No deploy allowlist: the pass is one
  // update against this deploy's own database, with no vendor call to
  // stampede.
  async sweep(job: JobRun<ScheduleData>): Promise<void> {
    const { count } = await this.model.updateMany({
      where: {
        status: SynthesisRunStatus.running,
        createdAt: { lt: subMinutes(new Date(), STALE_AFTER_MINUTES) },
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

    // A send that finished while its priority's pooled run was in flight
    // marked that run owed. Once the run is done, pool again so the send's
    // answers reach the priority's themes. Grouped by priority, so two
    // re-pools of one priority never start at once.
    const owed = await this.model.findMany({
      where: OWED_REPOOL_WHERE,
      select: { id: true, priorityId: true },
    })
    await this.jobs.sendMany(
      'feedbackSynthesisRepool',
      owed.map((run) => ({
        data: { runId: run.id },
        key: `${run.id}:${job.id}`,
        group: `priority:${run.priorityId}`,
      })),
    )
  }

  // The feedbackSynthesisRepool job's worker. The flag clears only once the
  // re-pool is settled, so a failure leaves it owed: the job retries, and
  // the next sweep sends it again.
  async repool(job: JobRun<{ runId: string }>): Promise<void> {
    const run = await this.model.findFirst({
      where: { id: job.data.runId, ...OWED_REPOOL_WHERE },
      select: { id: true, organizationSlug: true, priorityId: true },
    })
    if (run === null || run.priorityId === null) return
    try {
      await this.synthesis.requestPriorityRun({
        organizationSlug: run.organizationSlug,
        priorityId: run.priorityId,
        requestedByUserId: null,
      })
    } catch (err) {
      // A conflict re-marks the run now in flight; under the floor there is
      // nothing to pool.
      if (
        !(
          err instanceof HttpException &&
          EXPECTED_REPOOL_REFUSALS.has(err.getStatus())
        )
      ) {
        throw err
      }
    }
    await this.model.update({
      where: { id: run.id },
      data: { repoolOwed: false },
    })
  }
}
