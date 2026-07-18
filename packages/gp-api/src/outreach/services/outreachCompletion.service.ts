import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isBefore } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  getMidnightForDate,
  parseIsoDateAsUTC,
} from 'src/shared/util/date.util'
import { Outreach, OutreachStatus } from '../../generated/prisma'
import { PeerlyJob, PeerlyJobStatus } from '../../vendors/peerly/peerly.types'
import { PeerlyP2pJobService } from '../../vendors/peerly/services/peerlyP2pJob.service'

// Activity conditions (task 04) and the wizard's campaign picker (task 09)
// reference a completed outreach days later, not minutes — hourly is plenty.
const OUTREACH_COMPLETION_SWEEP_CRON = '0 * * * *'

// ENG-10739: the prior predicate (`leads_remaining === 0`) was disproven
// against real dev jobs. `leads_remaining` is the Peerly agent work-queue
// depth, not list progress — a never-sent job with a full unworked list can
// already read 0 (nothing dispatched to the queue yet) and read completed on
// its first sweep, while a fully-worked job can sit above 0 forever. `end_date`
// (the job's scheduled end, `YYYY-MM-DD`) is the available terminal signal:
// once its UTC calendar day is strictly in the past, Peerly is done running
// the job regardless of queue depth. This is a time-based proxy, not a read of
// Peerly's own delivery outcome — a CDR-based (call detail record) source of
// truth is the follow-up refinement tracked in ENG-10740.
export const isPeerlyJobComplete = (job: PeerlyJob, now: Date): boolean =>
  isBefore(parseIsoDateAsUTC(job.end_date), getMidnightForDate(now))

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
//
// `PENDING` (queued, not yet loaded by a Peerly agent) is checked before
// `isPeerlyJobComplete`: a job can be polled while still pending with an
// `end_date` already in the past (e.g. a stale schedule that was never
// picked up), and that must read as pending/not-started, never ratcheted
// straight to completed.
//
// `PAUSED` deliberately falls through to the temporal check: Peerly has no
// terminal-success status — genuinely finished jobs read PAUSED
// (ENG-10727, verified against real dev jobs), so guarding PAUSED out of
// completion would pin every finished send in_progress forever. The cost
// is that a job paused before ever sending also completes once its window
// closes; distinguishing the two needs delivery evidence, which is
// ENG-10740's CDR-truth refinement.
export const mapPeerlyJobToOutreachStatus = (
  job: PeerlyJob,
  now: Date,
): OutreachStatus | null => {
  if (
    job.status === PeerlyJobStatus.DELETED ||
    job.status === PeerlyJobStatus.ERROR
  ) {
    return null
  }
  if (job.status === PeerlyJobStatus.PENDING) {
    return OutreachStatus.pending
  }
  if (isPeerlyJobComplete(job, now)) {
    return OutreachStatus.completed
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

    const now = new Date()
    for (const outreach of candidates) {
      if (!outreach.projectId) {
        continue
      }
      try {
        await this.syncOutreachStatus(outreach, outreach.projectId, now)
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
    now: Date,
  ): Promise<void> {
    const job = await this.peerlyP2pJobService.getJob(projectId)
    const nextStatus = mapPeerlyJobToOutreachStatus(job, now)
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
