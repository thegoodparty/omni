import { BadGatewayException } from '@nestjs/common'
import type {
  GetTranscriptionJobCommandInput,
  StartTranscriptionJobCommandInput,
} from '@aws-sdk/client-transcribe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { RobocallTranscriptionService } from './robocallTranscription.service'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

// The client + Command classes are all `new`-ed, so the mocks must be
// constructable (classes), not arrow-returning fns.
vi.mock('@aws-sdk/client-transcribe', () => {
  class TranscribeClient {
    send = mockSend
  }
  class StartTranscriptionJobCommand {
    kind = 'start'
    constructor(public input: StartTranscriptionJobCommandInput) {}
  }
  class GetTranscriptionJobCommand {
    kind = 'get'
    constructor(public input: GetTranscriptionJobCommandInput) {}
  }
  return {
    TranscribeClient,
    StartTranscriptionJobCommand,
    GetTranscriptionJobCommand,
  }
})

const transcriptBuffer = (text: string): Buffer =>
  Buffer.from(
    JSON.stringify({ results: { transcripts: [{ transcript: text }] } }),
  )

describe('RobocallTranscriptionService', () => {
  let service: RobocallTranscriptionService
  let s3: { getFileBytes: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockSend.mockReset()
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
    mockSend.mockImplementation((cmd: { kind: string }) =>
      cmd.kind === 'start'
        ? {}
        : { TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED' } },
    )
    s3.getFileBytes.mockResolvedValue(transcriptBuffer('hello voters'))

    const text = await service.transcribe(params)

    expect(text).toBe('hello voters')
    // Job was started with the S3 URI + mapped media format.
    const start = mockSend.mock.calls[0]?.[0]
    expect(start.input.Media.MediaFileUri).toBe(
      's3://robocall-audio-test/robocall/1/clip.webm',
    )
    expect(start.input.MediaFormat).toBe('webm')
  })

  it('throws a 502 when the job fails', async () => {
    mockSend.mockImplementation((cmd: { kind: string }) =>
      cmd.kind === 'start'
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

  it('rejects an unsupported content type before starting a job', async () => {
    await expect(
      service.transcribe({ ...params, contentType: 'audio/flac' }),
    ).rejects.toBeInstanceOf(BadGatewayException)
    expect(mockSend).not.toHaveBeenCalled()
  })
})
