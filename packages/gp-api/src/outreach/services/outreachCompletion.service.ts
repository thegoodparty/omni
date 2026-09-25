import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isBefore, subDays } from 'date-fns'
import { CronLockService } from 'src/cron/services/cronLock.service'
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
const OUTREACH_COMPLETION_JOB = 'outreachCompletionSweep'

// A row whose send day is this far behind is not going to change on its own:
// the ones that reach this age are the ones whose Peerly read has failed
// every hour for months (the job is gone upstream), and each poll of them is
// Peerly budget spent for nothing. They stay pending/in_progress — a status we
// cannot verify is left alone, not guessed — and need a manual reconcile.
export const OUTREACH_COMPLETION_MAX_AGE_DAYS = 30

// ENG-10739: the prior predicate (`leads_remaining === 0`) was disproven
// against real dev jobs. `leads_remaining` is the Peerly agent work-queue
// depth, not list progress — a never-sent job with a full unworked list can
// already read 0 (nothing dispatched to the queue yet) and read completed on
// its first sweep, while a fully-worked job can sit above 0 forever.
//
// `end_date` was the next predicate and is wrong too (ENG-11157): Peerly's
// end_date is a REPLY window, not a send window. An automated Peerly process
// moves it to `start_date + 15 days` at ~08:01 UTC the morning after the send
// so replies keep flowing to the candidate, and a job whose window was
// pre-extended sat in_progress for two weeks after its texts went out.
//
// A Peerly job sends on its `start_date` day, so once that UTC calendar day is
// strictly in the past the send is over. Still a time-based proxy, not a read
// of Peerly's own delivery outcome — a CDR-based (call detail record) source
// of truth is the follow-up refinement tracked in ENG-10740.
export const isPeerlyJobComplete = (job: PeerlyJob, now: Date): boolean =>
  isBefore(parseIsoDateAsUTC(job.start_date), getMidnightForDate(now))

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
// `isPeerlyJobComplete`: a job can be polled while still pending with a
// `start_date` already in the past (e.g. a stale schedule that was never
// picked up), and that must read as pending/not-started, never ratcheted
// straight to completed.
//
// `PAUSED` deliberately falls through to the temporal check: Peerly has no
// terminal-success status — genuinely finished jobs read PAUSED
// (ENG-10727, verified against real dev jobs), so guarding PAUSED out of
// completion would pin every finished send in_progress forever. The cost
// is that a job paused before ever sending also completes once its day
// passes; distinguishing the two needs delivery evidence, which is
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
  // A job scheduled for the future reads `paused` in Peerly (verified against
  // a real dev job, ENG-10727's inverse case), and `paused` alone must not
  // ratchet the row to in_progress two weeks before anything sends — that
  // both lies in the history UI and strips the pending-only cancel window.
  // Not started until the start_date UTC day begins.
  if (isBefore(now, parseIsoDateAsUTC(job.start_date))) {
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
  constructor(
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly cronLock: CronLockService,
  ) {
    super()
  }

  // Scope: only outreaches created through the Peerly path carry a
  // `projectId` (today that's p2p). Robocall and other channels without a
  // Peerly job id are out of scope until their own completion lifecycle
  // exists — conditions naming them stay blocked, by design.
  //
  // Hourly-locked: every replica fires the same @Cron, and each unlocked
  // pass is one Peerly read per open row, so two replicas doubled the
  // account's job-status traffic for no second answer (the retrieve_cv
  // budget Peerly asked us to cut in August was the same shape).
  @Cron(OUTREACH_COMPLETION_SWEEP_CRON, { name: OUTREACH_COMPLETION_JOB })
  async sweepOutreachCompletions(): Promise<void> {
    const now = new Date()
    if (!(await this.cronLock.tryClaimHourlyRun(OUTREACH_COMPLETION_JOB, now)))
      return

    try {
      const candidates = await this.model.findMany({
        where: {
          projectId: { not: null },
          AND: [
            {
              // `status` is nullable with a DB default of `pending`; treat
              // NULL as `pending` here too.
              OR: [
                { status: null },
                { status: OutreachStatus.pending },
                { status: OutreachStatus.in_progress },
              ],
            },
            {
              OR: [
                {
                  date: { gte: subDays(now, OUTREACH_COMPLETION_MAX_AGE_DAYS) },
                },
                // A dateless row (a resume can omit `date`) ages off its
                // creation instead, or it would bypass the cutoff for good.
                {
                  AND: [
                    { date: null },
                    {
                      createdAt: {
                        gte: subDays(now, OUTREACH_COMPLETION_MAX_AGE_DAYS),
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      })

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
    } finally {
      await this.cronLock.markHourlyCompleted(OUTREACH_COMPLETION_JOB, now)
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

    // CAS on the status the decision was based on: cancel can claim the
    // row (pending → canceled) between this sweep's fetch and its write,
    // and an unguarded update would resurrect a canceled row — whose
    // vendor job is deleted and charge refunded — as in_progress.
    await this.model.updateMany({
      where: { id: outreach.id, status: outreach.status },
      data: { status: nextStatus },
    })
  }
}
