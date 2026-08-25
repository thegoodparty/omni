import { randomUUID } from 'node:crypto'
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { ROBOCALL_AUDIO_ALLOWED_MIME_TYPES } from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { S3Service } from '@/vendors/aws/services/s3.service'

const { AWS_REGION: region = 'us-west-2' } = process.env

// The Transcribe output JSON we read back from S3 (only the fields we use).
const TranscriptFileSchema = z.object({
  results: z.object({
    transcripts: z.array(z.object({ transcript: z.string() })),
  }),
})

// The upload allowlist is the transcription allowlist (you can't transcribe
// what you couldn't upload), so bind to the one contract constant rather than
// repeating it — a second copy would silently drift.
const SUPPORTED_MIME_TYPES = new Set<string>(ROBOCALL_AUDIO_ALLOWED_MIME_TYPES)

const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 40 // ~2 min ceiling for a ≤60s clip

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

interface TranscribeParams {
  bucket: string
  key: string
  contentType: string
}

// Batch transcription of a stored robocall recording via AWS Transcribe. The
// mic-dictation path uses Transcribe STREAMING (raw PCM); a stored webm/mp4/mp3
// needs the batch job, which decodes those containers from S3 directly.
@Injectable()
export class RobocallTranscriptionService {
  private readonly client: TranscribeClient

  constructor(
    private readonly logger: PinoLogger,
    private readonly s3: S3Service,
  ) {
    this.logger.setContext(RobocallTranscriptionService.name)
    this.client = new TranscribeClient({ region })
  }

  async transcribe(params: TranscribeParams): Promise<string> {
    if (!SUPPORTED_MIME_TYPES.has(params.contentType)) {
      throw new BadGatewayException(
        `Unsupported audio type for transcription: ${params.contentType}`,
      )
    }

    const jobName = `robocall-compliance-${randomUUID()}`
    const outputKey = `transcripts/${jobName}.json`

    try {
      // No MediaFormat: our clips are audio-only MPEG-4 (Safari's audio/mp4 and
      // uploaded .m4a alike), which AWS may detect as either `mp4` or `m4a`; a
      // declared format that mismatches the detected one FAILS the job and
      // would 502 this fail-closed gate on a valid recording. Let Transcribe
      // detect it instead.
      await this.client.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          LanguageCode: 'en-US',
          Media: { MediaFileUri: `s3://${params.bucket}/${params.key}` },
          OutputBucketName: params.bucket,
          OutputKey: outputKey,
        }),
      )

      for (let poll = 0; poll < MAX_POLLS; poll++) {
        const { TranscriptionJob } = await this.client.send(
          new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
        )
        const status = TranscriptionJob?.TranscriptionJobStatus
        if (status === 'COMPLETED') {
          return this.readTranscript(params.bucket, outputKey)
        }
        if (status === 'FAILED') {
          throw new BadGatewayException(
            `Transcription failed: ${TranscriptionJob?.FailureReason ?? 'unknown'}`,
          )
        }
        await sleep(POLL_INTERVAL_MS)
      }
      throw new BadGatewayException('Transcription timed out')
    } catch (error) {
      if (error instanceof BadGatewayException) throw error
      this.logger.error({ err: error }, 'Robocall transcription failed')
      throw new BadGatewayException('Robocall transcription failed')
    }
  }

  private async readTranscript(
    bucket: string,
    outputKey: string,
  ): Promise<string> {
    const bytes = await this.s3.getFileBytes(bucket, outputKey)
    if (!bytes) throw new BadGatewayException('Transcript output missing')
    const parsed = TranscriptFileSchema.parse(JSON.parse(bytes.toString()))
    return parsed.results.transcripts.map((t) => t.transcript).join(' ')
  }
}
