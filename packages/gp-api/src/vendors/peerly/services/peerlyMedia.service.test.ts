import { BadGatewayException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import FormData from 'form-data'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { PeerlyMediaService } from './peerlyMedia.service'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'

describe('PeerlyMediaService', () => {
  let service: PeerlyMediaService
  let mockHttpService: {
    post: ReturnType<typeof vi.fn>
    validateResponse: ReturnType<typeof vi.fn>
  }
  let mockErrorHandling: {
    handleApiError: ReturnType<typeof vi.fn>
  }
  let appendSpy: MockInstance<FormData['append']>

  const mockMediaResponse = {
    media_id: 'media-123',
    status: 'ACTIVE',
    error: null,
  }

  const baseParams = {
    identityId: '11540057',
    fileStream: Buffer.from('fake-image-bytes'),
    mimeType: 'image/jpeg',
  }

  const getSentFilename = () => {
    const uploadCall = appendSpy.mock.calls.find(
      ([field]) => field === 'initial_file_upload',
    )
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const options = uploadCall?.[2] as { filename: string }
    return options.filename
  }

  beforeEach(async () => {
    mockHttpService = {
      post: vi.fn().mockResolvedValue({ data: mockMediaResponse }),
      validateResponse: vi.fn().mockImplementation((data) => data),
    }
    mockErrorHandling = {
      handleApiError: vi.fn().mockImplementation(() => {
        throw new BadGatewayException('mock error')
      }),
    }
    appendSpy = vi.spyOn(FormData.prototype, 'append')

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerlyMediaService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: PeerlyHttpService, useValue: mockHttpService },
        { provide: PeerlyErrorHandlingService, useValue: mockErrorHandling },
      ],
    }).compile()

    service = module.get(PeerlyMediaService)
    Object.defineProperty(service, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
  })

  afterEach(() => {
    appendSpy.mockRestore()
  })

  describe('createMedia', () => {
    it('returns media_id on success', async () => {
      const result = await service.createMedia({
        ...baseParams,
        fileName: 'image.jpeg',
      })

      expect(result).toBe('media-123')
    })

    it('passes a short filename through unchanged', async () => {
      await service.createMedia({ ...baseParams, fileName: 'image.jpeg' })

      expect(getSentFilename()).toBe('image.jpeg')
    })

    // Peerly's /v2/media 400s ("An unknown validation error occurred.") on
    // filenames longer than 100 chars — verified live 2026-07-22.
    it('truncates filenames over 100 chars, keeping the extension', async () => {
      const stem = 'a'.repeat(120)
      await service.createMedia({ ...baseParams, fileName: `${stem}.png` })

      const sent = getSentFilename()
      expect(sent).toHaveLength(100)
      expect(sent).toBe(`${'a'.repeat(96)}.png`)
    })

    it('leaves a filename of exactly 100 chars unchanged', async () => {
      const fileName = `${'a'.repeat(96)}.png`
      await service.createMedia({ ...baseParams, fileName })

      expect(getSentFilename()).toBe(fileName)
    })
  })
})
