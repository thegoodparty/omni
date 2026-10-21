import { createHash, randomUUID } from 'node:crypto'
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe'
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { SEED_MEMOS } from '@/constituentFeedback/services/feedbackSeedMemos'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SPEECH_BUCKET } from '../speechBucket'

const { AWS_REGION: region = 'us-west-2' } = process.env

const OUTPUT_PREFIX = 'constituent-feedback-transcripts'

// How long a mock job "runs". Long enough that the first poll after a memo
// lands sees it in progress, as a real one would.
const MOCK_JOB_MS = 3_000
const MOCK_JOB_PREFIX = 'mock'

export type TranscribeFileMode = 'aws' | 'mock'

// Read at boot. Unset means S3 and batch Transcribe. Any other value is a
// typo that would otherwise quietly send a laptop's audio to AWS, so boot
// refuses it, as FEEDBACK_SYNTHESIS_ENGINE does.
export const transcribeFileMode = (): TranscribeFileMode => {
  const value = process.env.SPEECH_TRANSCRIBE_FILE_MODE || 'aws'
  if (value === 'aws' || value === 'mock') return value
  throw new Error(
    `SPEECH_TRANSCRIBE_FILE_MODE must be "aws" or "mock", got "${value}"`,
  )
}

export type TranscriptionResult =
  | { status: 'in_progress' }
  | { status: 'completed'; transcript: string }
  | { status: 'failed'; reason: string }

// The Transcribe output JSON (only the fields we read).
const TranscriptFileSchema = z.object({
  results: z.object({
    transcripts: z.array(z.object({ transcript: z.string() })),
  }),
})

// The same key always lands on the same sentence, so a memo reads the same
// on every run of a walkthrough.
const fixtureIndexFor = (audioKey: string): number =>
  parseInt(
    createHash('sha256').update(audioKey).digest('hex').slice(0, 8),
    16,
  ) % SEED_MEMOS.length

// Batch transcription of a recording already in the speech bucket. Live
// dictation streams PCM to Transcribe; a stored recording is whatever
// MediaRecorder wrote (webm/opus on Chrome, mp4 on Safari), which streaming
// does not accept and the batch job decodes from S3 directly.
//
// Asynchronous on purpose: a job takes seconds to a minute, so `transcribeFile`
// only starts it and the pending-transcription cron polls `fetchResult`.
@Injectable()
export class TranscribeFileService {
  readonly mode: TranscribeFileMode = transcribeFileMode()
  private readonly client = new TranscribeClient({ region })

  constructor(
    private readonly s3: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TranscribeFileService.name)
  }

  async transcribeFile(audioKey: string): Promise<{ jobName: string }> {
    if (this.mode === 'mock') {
      return {
        jobName: `${MOCK_JOB_PREFIX}-${Date.now()}-${fixtureIndexFor(audioKey)}`,
      }
    }

    const jobName = `constituent-feedback-${randomUUID()}`
    // No MediaFormat: Safari's audio/mp4 is detected as either `mp4` or
    // `m4a`, and a declared format that disagrees with the detected one fails
    // the job (robocallTranscription.service.ts learned this first).
    await this.client.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: 'en-US',
        Media: { MediaFileUri: `s3://${SPEECH_BUCKET}/${audioKey}` },
        OutputBucketName: SPEECH_BUCKET,
        OutputKey: `${OUTPUT_PREFIX}/${jobName}.json`,
      }),
    )
    return { jobName }
  }

  async fetchResult(jobName: string): Promise<TranscriptionResult> {
    if (this.mode === 'mock') return this.fetchMockResult(jobName)

    const { TranscriptionJob } = await this.client.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    )
    const status = TranscriptionJob?.TranscriptionJobStatus
    if (status === 'FAILED') {
      return {
        status: 'failed',
        reason: TranscriptionJob?.FailureReason ?? 'unknown',
      }
    }
    if (status !== 'COMPLETED') return { status: 'in_progress' }

    const bytes = await this.s3.getFileBytes(
      SPEECH_BUCKET,
      `${OUTPUT_PREFIX}/${jobName}.json`,
    )
    if (!bytes) return { status: 'failed', reason: 'transcript_missing' }
    const parsed = TranscriptFileSchema.parse(JSON.parse(bytes.toString()))
    return {
      status: 'completed',
      transcript: parsed.results.transcripts
        .map((part) => part.transcript)
        .join(' ')
        .trim(),
    }
  }

  // Stateless, so a restart or the other replica polls the same answer: the
  // start time and the sentence ride in the job name.
  private fetchMockResult(jobName: string): TranscriptionResult {
    const [prefix, startedAt, index] = jobName.split('-')
    const memo = SEED_MEMOS[Number(index)]
    if (prefix !== MOCK_JOB_PREFIX || memo === undefined) {
      this.logger.warn({ jobName }, 'Not a mock transcription job')
      return { status: 'failed', reason: 'unknown_mock_job' }
    }
    if (Date.now() - Number(startedAt) < MOCK_JOB_MS) {
      return { status: 'in_progress' }
    }
    return { status: 'completed', transcript: memo.transcript }
  }
}
