import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subHours, subMinutes } from 'date-fns'
import { ConstituentFeedbackExtractionStatus, Prisma } from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  TranscribeFileService,
  type TranscriptionResult,
} from '@/speech/services/transcribeFile.service'
import { ConstituentFeedbackService } from './constituentFeedback.service'

const JOB = 'feedbackPendingTranscription'

// A pass is one Transcribe call per row plus an extraction for each that
// finished; this keeps one inside its minute.
const BATCH_SIZE = 25

// A batch job takes seconds to a minute. One with no word for an hour is
// treated as failed, so it is started again or given up rather than holding
// a slot in every batch forever.
const GIVE_UP_AFTER_MINUTES = 60

// Jobs started, or tried, per recording before the memo is marked failed:
// a recording no job could read.
export const MAX_TRANSCRIPTION_ATTEMPTS = 3

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

// Turns offline memos' recordings into transcripts and confirms them, and
// confirms live memos whose confirm step was abandoned. Every minute,
// because a batch job takes about that long.
//
// No deploy allowlist: the pass reads this deploy's own database and calls
// Transcribe only for memos recorded on it, so previews cannot stampede.
// The lock stops prod's two replicas both polling.
@Injectable()
export class PendingTranscriptionService extends createPrismaBase(
  MODELS.ConstituentFeedback,
) {
  constructor(
    private readonly cronLock: CronLockService,
    private readonly transcribeFile: TranscribeFileService,
    private readonly feedback: ConstituentFeedbackService,
  ) {
    super()
  }

  @Cron('* * * * *', { name: JOB, timeZone: EASTERN_TIMEZONE })
  async pollPendingTranscriptions(): Promise<void> {
    await this.pass(new Date())
  }

  // Separate from the @Cron method, which the scheduler calls with its own
  // arguments, so a test can pin the slot.
  async pass(now: Date): Promise<void> {
    // Read before claiming: almost every minute has nothing to do, and a
    // claim is a cron_run row.
    const [rows, abandoned] = await Promise.all([
      this.findMany({
        where: AWAITING_TRANSCRIPT,
        orderBy: { updatedAt: Prisma.SortOrder.asc },
        take: BATCH_SIZE,
        select: {
          id: true,
          audioKey: true,
          transcriptionJobName: true,
          transcriptionAttempts: true,
          updatedAt: true,
        },
      }),
      this.findMany({
        where: {
          transcript: { not: null },
          confirmedAt: null,
          updatedAt: { lt: subHours(now, ABANDONED_CONFIRM_AFTER_HOURS) },
        },
        orderBy: { updatedAt: Prisma.SortOrder.asc },
        take: BATCH_SIZE,
        select: { id: true, updatedAt: true },
      }),
    ])
    if (rows.length === 0 && abandoned.length === 0) return
    if (!(await this.cronLock.tryClaimMinuteRun(JOB, now))) return

    try {
      for (const row of rows) {
        try {
          await this.advance(row, now)
        } catch (err) {
          // One bad memo must not stop the rest of the batch.
          this.logger.error(
            { err, id: row.id },
            'Memo transcription poll failed',
          )
        }
      }
      for (const row of abandoned) {
        try {
          await this.feedback.confirmAbandoned(row)
        } catch (err) {
          this.logger.error(
            { err, id: row.id },
            'Abandoned memo confirmation failed',
          )
        }
      }
    } finally {
      await this.cronLock.markMinuteCompleted(JOB, now)
    }
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

    // No job: it never started, or its last start failed.
    if (jobName === null) {
      if (attemptsLeft) {
        await this.feedback.startTranscription(row.id, audioKey)
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

    // Polled before the give-up, so a job that finished while this cron was
    // not running is read rather than failed.
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
