import { BadGatewayException, BadRequestException } from '@nestjs/common'
import {
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { RobocallTranscriptionService } from './robocallTranscription.service'

const transcriptBuffer = (text: string): Buffer =>
  Buffer.from(
    JSON.stringify({ results: { transcripts: [{ transcript: text }] } }),
  )

describe('RobocallTranscriptionService', () => {
  let service: RobocallTranscriptionService
  let s3: { getFileBytes: ReturnType<typeof vi.fn> }
  let mockSend: Mock<(command: unknown) => unknown>

  beforeEach(() => {
    mockSend = vi.fn()
    vi.spyOn(TranscribeClient.prototype, 'send').mockImplementation(
      (command: unknown) => mockSend(command),
    )
    s3 = { getFileBytes: vi.fn() }
    service = new RobocallTranscriptionService(
      createMockLogger(),
      s3 as unknown as S3Service,
    )
  })

  const params = {
    bucket: 'robocall-audio-test',
    key: 'robocall/1/clip.webm',
    contentType: 'audio/webm',
  }

  it('starts a job, polls to completion, and returns the transcript', async () => {
    mockSend.mockImplementation((cmd: unknown) =>
      cmd instanceof StartTranscriptionJobCommand
        ? {}
        : { TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED' } },
    )
    s3.getFileBytes.mockResolvedValue(transcriptBuffer('hello voters'))

    const text = await service.transcribe(params)

    expect(text).toBe('hello voters')
    // Job started with the S3 URI and NO declared MediaFormat — Transcribe
    // detects the format from the bytes (a mis-declared format fails the job).
    const start = mockSend.mock.calls[0]?.[0]
    if (!(start instanceof StartTranscriptionJobCommand)) {
      throw new Error('expected the first send to start the job')
    }
    expect(start.input.Media?.MediaFileUri).toBe(
      's3://robocall-audio-test/robocall/1/clip.webm',
    )
    expect(start.input.MediaFormat).toBeUndefined()
  })

  it('throws a 502 when the job fails', async () => {
    mockSend.mockImplementation((cmd: unknown) =>
      cmd instanceof StartTranscriptionJobCommand
        ? {}
        : {
            TranscriptionJob: {
              TranscriptionJobStatus: 'FAILED',
              FailureReason: 'bad audio',
            },
          },
    )

    await expect(service.transcribe(params)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('throws a 400 when Transcribe reports the media file as invalid', async () => {
    mockSend.mockImplementation((cmd: unknown) =>
      cmd instanceof StartTranscriptionJobCommand
        ? {}
        : {
            TranscriptionJob: {
              TranscriptionJobStatus: 'FAILED',
              FailureReason:
                "The data in your input media file isn't valid. Check the media file and try your request again.",
            },
          },
    )

    await expect(service.transcribe(params)).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects an unsupported content type before starting a job', async () => {
    await expect(
      service.transcribe({ ...params, contentType: 'audio/flac' }),
    ).rejects.toBeInstanceOf(BadGatewayException)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
