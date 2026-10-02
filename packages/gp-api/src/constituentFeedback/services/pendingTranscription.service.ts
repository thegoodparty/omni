import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { ConstituentFeedbackExtractionStatus, Prisma } from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { TranscribeFileService } from '@/speech/services/transcribeFile.service'
import { ConstituentFeedbackService } from './constituentFeedback.service'

const JOB = 'feedbackPendingTranscription'

// A pass is one Transcribe call per row plus an extraction for each that
// finished; this keeps one inside its minute.
const BATCH_SIZE = 25

// A batch job takes seconds to a minute. One with no word for an hour, or a
// row whose job never started, gives up, so it lands in "Notes to review"
// with "Try again" rather than holding a slot in every batch forever.
const GIVE_UP_AFTER_MINUTES = 60

// Offline memos whose recording is uploaded and whose words are not back.
const AWAITING_TRANSCRIPT = {
  extractionStatus: ConstituentFeedbackExtractionStatus.pending,
  audioKey: { not: null },
  transcript: null,
} satisfies Prisma.ConstituentFeedbackWhereInput

// Turns offline memos' recordings into transcripts and triples. Every
// minute, because a batch job takes about that long and the canvasser who
// just got signal back is the one waiting to review it.
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
    const rows = await this.findMany({
      where: AWAITING_TRANSCRIPT,
      orderBy: { updatedAt: Prisma.SortOrder.asc },
      take: BATCH_SIZE,
      select: {
        id: true,
        audioKey: true,
        transcriptionJobName: true,
        updatedAt: true,
      },
    })
    if (rows.length === 0) return
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
    } finally {
      await this.cronLock.markMinuteCompleted(JOB, now)
    }
  }

  private async advance(
    row: {
      id: string
      audioKey: string | null
      transcriptionJobName: string | null
      updatedAt: Date
    },
    now: Date,
  ): Promise<void> {
    const jobName = row.transcriptionJobName
    if (row.updatedAt < subMinutes(now, GIVE_UP_AFTER_MINUTES)) {
      await this.feedback.failTranscription({
        id: row.id,
        jobName,
        reason: 'timeout',
      })
      return
    }
    if (row.audioKey === null) return
    if (jobName === null) {
      await this.feedback.startTranscription(row.id, row.audioKey)
      return
    }

    const result = await this.transcribeFile.fetchResult(jobName)
    if (result.status === 'in_progress') return
    if (result.status === 'failed') {
      await this.feedback.failTranscription({
        id: row.id,
        jobName,
        reason: result.reason,
      })
      return
    }
    await this.feedback.completeTranscription({
      id: row.id,
      jobName,
      transcript: result.transcript,
    })
  }
}
