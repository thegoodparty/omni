import { Injectable } from '@nestjs/common'
import { subHours, subMinutes } from 'date-fns'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  Prisma,
} from '@/generated/prisma'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  TranscribeFileService,
  type TranscriptionResult,
} from '@/speech/services/transcribeFile.service'
import { ConstituentFeedbackService } from './constituentFeedback.service'

// Memos queued per minute. Each is one Transcribe call, plus an extraction
// when its job finished.
const BATCH_SIZE = 25

// A batch job takes seconds to a minute. One with no word for an hour is
// treated as failed, so it is started again or given up rather than holding
// a slot in every batch forever.
const GIVE_UP_AFTER_MINUTES = 60

// Jobs started, or tried, per recording before the memo is marked failed:
// a recording no job could read.
export const MAX_TRANSCRIPTION_ATTEMPTS = 3

// A failed start is retried only this long after the last attempt, so
// three attempts span a Transcribe or AWS outage of a few minutes instead
// of all failing inside it.
export const START_RETRY_AFTER_MINUTES = 10

// A live memo still unconfirmed this long after its last write had its
// confirm step abandoned: the app closed on the card. Long enough that a
// canvasser mid-walk is never overtaken.
export const ABANDONED_CONFIRM_AFTER_HOURS = 2

// Offline memos whose recording is uploaded and whose words are not back.
// A memo confirmed meanwhile is done: its job's words would be thrown away.
const AWAITING_TRANSCRIPT = {
  extractionStatus: ConstituentFeedbackExtractionStatus.pending,
  audioKey: { not: null },
  transcript: null,
  confirmedAt: null,
} satisfies Prisma.ConstituentFeedbackWhereInput

// Live memos whose confirm step was abandoned.
const abandonedConfirmWhere = (
  now: Date,
): Prisma.ConstituentFeedbackWhereInput => ({
  transcript: { not: null },
  confirmedAt: null,
  // A text reply has no confirm step to abandon.
  channel: { not: ConstituentFeedbackChannel.text },
  updatedAt: { lt: subHours(now, ABANDONED_CONFIRM_AFTER_HOURS) },
})

// Turns offline memos' recordings into transcripts and confirms them, and
// confirms live memos whose confirm step was abandoned. Every minute,
// because a batch job takes about that long.
//
// No deploy allowlist: the pass reads this deploy's own database and calls
// Transcribe only for memos recorded on it, so previews cannot stampede.
@Injectable()
export class PendingTranscriptionService extends createPrismaBase(
  MODELS.ConstituentFeedback,
) {
  constructor(
    private readonly jobs: JobsService,
    private readonly transcribeFile: TranscribeFileService,
    private readonly feedback: ConstituentFeedbackService,
  ) {
    super()
  }

  // The feedbackPendingTranscription schedule's worker
  // (src/jobs/jobs.registry.ts). One feedbackTranscriptionAdvance job per
  // memo waiting on its words, grouped by the memo so two minutes' polls of
  // one memo never overlap, and one feedbackAbandonedConfirm job per live
  // memo whose confirm step was abandoned.
  async fanOut(job: JobRun<ScheduleData>): Promise<void> {
    const now = new Date()
    const [rows, abandoned] = await Promise.all([
      this.findMany({
        where: AWAITING_TRANSCRIPT,
        orderBy: { updatedAt: Prisma.SortOrder.asc },
        take: BATCH_SIZE,
        select: { id: true },
      }),
      this.findMany({
        where: abandonedConfirmWhere(now),
        orderBy: { updatedAt: Prisma.SortOrder.asc },
        take: BATCH_SIZE,
        select: { id: true },
      }),
    ])
    await this.jobs.sendMany(
      'feedbackTranscriptionAdvance',
      rows.map(({ id }) => ({
        data: { feedbackId: id },
        key: `${id}:${job.id}`,
        group: `feedback:${id}`,
      })),
    )
    await this.jobs.sendMany(
      'feedbackAbandonedConfirm',
      abandoned.map(({ id }) => ({
        data: { feedbackId: id },
        key: `${id}:${job.id}`,
      })),
    )
  }

  // The feedbackTranscriptionAdvance job's worker. Read again here: the
  // memo may have been confirmed or finished since the schedule found it.
  async advanceScheduled(job: JobRun<{ feedbackId: string }>): Promise<void> {
    const row = await this.findFirst({
      where: { id: job.data.feedbackId, ...AWAITING_TRANSCRIPT },
      select: {
        id: true,
        audioKey: true,
        transcriptionJobName: true,
        transcriptionAttempts: true,
        updatedAt: true,
      },
    })
    if (!row) return
    await this.advance(row, new Date())
  }

  // The feedbackAbandonedConfirm job's worker.
  async confirmAbandonedScheduled(
    job: JobRun<{ feedbackId: string }>,
  ): Promise<void> {
    const row = await this.findFirst({
      where: { id: job.data.feedbackId, ...abandonedConfirmWhere(new Date()) },
      select: { id: true, updatedAt: true },
    })
    if (!row) return
    await this.feedback.confirmAbandoned(row)
  }

  private async advance(
    row: {
      id: string
      audioKey: string | null
      transcriptionJobName: string | null
      transcriptionAttempts: number
      updatedAt: Date
    },
    now: Date,
  ): Promise<void> {
    const { audioKey } = row
    // AWAITING_TRANSCRIPT already excludes it; this narrows the type.
    if (audioKey === null) return
    const jobName = row.transcriptionJobName
    const stale = row.updatedAt < subMinutes(now, GIVE_UP_AFTER_MINUTES)
    const attemptsLeft = row.transcriptionAttempts < MAX_TRANSCRIPTION_ATTEMPTS

    // No job: it never started, or its last start failed. The last attempt
    // is the row's last write.
    if (jobName === null) {
      if (attemptsLeft) {
        const retryDue =
          row.transcriptionAttempts === 0 ||
          row.updatedAt <= subMinutes(now, START_RETRY_AFTER_MINUTES)
        if (retryDue) {
          await this.feedback.startTranscription(row.id, audioKey)
        }
      } else {
        await this.feedback.failTranscription({
          id: row.id,
          jobName,
          reason: 'start_failed',
        })
      }
      return
    }

    const failed = (reason: string) =>
      attemptsLeft
        ? this.feedback.restartTranscription({
            id: row.id,
            jobName,
            audioKey,
            reason,
          })
        : this.feedback.failTranscription({ id: row.id, jobName, reason })

    // Polled before the give-up, so a job that finished while this schedule
    // was not running is read rather than failed.
    let result: TranscriptionResult
    try {
      result = await this.transcribeFile.fetchResult(jobName)
    } catch (err) {
      if (stale) return failed('timeout')
      throw err
    }
    if (result.status === 'in_progress') {
      if (stale) await failed('timeout')
      return
    }
    if (result.status === 'failed') {
      await failed(result.reason)
      return
    }
    await this.feedback.completeTranscription({
      id: row.id,
      jobName,
      transcript: result.transcript,
    })
  }
}
