import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Outreach, OutreachStatus } from '../../generated/prisma'
import { PeerlyJob, PeerlyJobStatus } from '../../vendors/peerly/peerly.types'
import { PeerlyP2pJobService } from '../../vendors/peerly/services/peerlyP2pJob.service'

// Activity conditions (task 04) and the wizard's campaign picker (task 09)
// reference a completed outreach days later, not minutes — hourly is plenty.
const OUTREACH_COMPLETION_SWEEP_CRON = '0 * * * *'

// UNCONFIRMED HYPOTHESIS (ENG-10702): `PeerlyJobStatus` has no terminal-success
// value, so `leads_remaining === 0` is the best available signal that a job
// has worked every lead in its list. This has NOT been observed against a
// real finished dev Peerly job (no dev Peerly access from this environment).
// If a real finished job disagrees with this predicate, the fallback (a
// time-based completion signal? relaxing the activity-condition rule?) is a
// product call for Tomer, not something to guess here.
export const isPeerlyJobComplete = (job: PeerlyJob): boolean =>
  job.leads_remaining === 0

// One-way ratchet: a row only ever moves to a higher rank, so a stale or odd
// Peerly read can never move it backward. `deleted`/`error` never appear here
// (mapPeerlyJobToOutreachStatus returns null for them).
const STATUS_RANK: Partial<Record<OutreachStatus, number>> = {
  [OutreachStatus.pending]: 0,
  [OutreachStatus.in_progress]: 1,
  [OutreachStatus.completed]: 2,
}

const isForwardTransition = (
  current: OutreachStatus,
  next: OutreachStatus,
): boolean => (STATUS_RANK[next] ?? -1) > (STATUS_RANK[current] ?? -1)

// `deleted`/`error` are terminal-unsuccessful, not completed — mapped to
// `null` so the caller logs and leaves the outreach status untouched rather
// than letting a dead job become a pickable campaign.
export const mapPeerlyJobToOutreachStatus = (
  job: PeerlyJob,
): OutreachStatus | null => {
  if (
    job.status === PeerlyJobStatus.DELETED ||
    job.status === PeerlyJobStatus.ERROR
  ) {
    return null
  }
  if (isPeerlyJobComplete(job)) {
    return OutreachStatus.completed
  }
  if (job.status === PeerlyJobStatus.PENDING) {
    return OutreachStatus.pending
  }
  return OutreachStatus.in_progress
}

@Injectable()
export class OutreachCompletionService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(private readonly peerlyP2pJobService: PeerlyP2pJobService) {
    super()
  }

  // Scope: only outreaches created through the Peerly path carry a
  // `projectId` (today that's p2p). Robocall and other channels without a
  // Peerly job id are out of scope until their own completion lifecycle
  // exists — conditions naming them stay blocked, by design.
  @Cron(OUTREACH_COMPLETION_SWEEP_CRON, { name: 'outreachCompletionSweep' })
  async sweepOutreachCompletions(): Promise<void> {
    const candidates = await this.model.findMany({
      where: {
        projectId: { not: null },
        // `status` is nullable with a DB default of `pending`; treat NULL as
        // `pending` here too.
        OR: [
          { status: null },
          { status: OutreachStatus.pending },
          { status: OutreachStatus.in_progress },
        ],
      },
    })

    for (const outreach of candidates) {
      if (!outreach.projectId) {
        continue
      }
      try {
        await this.syncOutreachStatus(outreach, outreach.projectId)
      } catch (err) {
        // A single job's Peerly failure (transient 4xx/5xx) must not abort
        // the sweep for the rest, and must not page — this only logs.
        this.logger.warn(
          { err, outreachId: outreach.id, projectId: outreach.projectId },
          '[Outreach Completion] Peerly job status check failed; will retry next sweep',
        )
      }
    }
  }

  private async syncOutreachStatus(
    outreach: Outreach,
    projectId: string,
  ): Promise<void> {
    const job = await this.peerlyP2pJobService.getJob(projectId)
    const nextStatus = mapPeerlyJobToOutreachStatus(job)
    if (!nextStatus) {
      this.logger.warn(
        { outreachId: outreach.id, projectId, peerlyStatus: job.status },
        '[Outreach Completion] Peerly job is terminal-unsuccessful; leaving outreach status untouched',
      )
      return
    }

    const currentStatus = outreach.status ?? OutreachStatus.pending
    if (!isForwardTransition(currentStatus, nextStatus)) {
      return
    }

    await this.model.update({
      where: { id: outreach.id },
      data: { status: nextStatus },
    })
  }
}
