import { HttpStatus } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MimeTypes } from 'http-constants-ts'
import { LoggerModule } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { UserAvatarService } from './userAvatar.service'

const PNG = new Uint8Array([137, 80, 78, 71])

describe('UserAvatarService', () => {
  let service: UserAvatarService
  let uploadFile: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    uploadFile = vi
      .fn()
      .mockResolvedValue('https://assets.test/uploads/1/a.png')
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: { enabled: false } })],
      providers: [
        UserAvatarService,
        {
          provide: S3Service,
          useValue: {
            buildKey: (folder: string, file: string) => `${folder}/${file}`,
            uploadFile,
          },
        },
      ],
    }).compile()
    service = moduleRef.get(UserAvatarService)
  })

  it('uploads a fetched image and returns our url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': MimeTypes.IMAGE_PNG,
          'content-length': '4',
        }),
        arrayBuffer: () => Promise.resolve(PNG.buffer),
      }),
    )

    const url = await service.ingestFromUrl(1, 'https://img.clerk.com/x')

    expect(url).toBe('https://assets.test/uploads/1/a.png')
    expect(uploadFile).toHaveBeenCalledOnce()
  })

  it('returns null when the source is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        // http-constants-ts misnames its text/* constants as IMAGE_* —
        // IMAGE_HTML's value is 'text/html'.
        headers: new Headers({ 'content-type': MimeTypes.IMAGE_HTML }),
        arrayBuffer: () => Promise.resolve(PNG.buffer),
      }),
    )

    expect(await service.ingestFromUrl(1, 'https://img.clerk.com/x')).toBe(null)
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('returns null when the source responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(PNG.buffer),
      }),
    )

    expect(await service.ingestFromUrl(1, 'https://img.clerk.com/x')).toBe(null)
  })

  it('returns null when the image exceeds the size cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': MimeTypes.IMAGE_PNG,
          'content-length': String(10 * 1024 * 1024),
        }),
        arrayBuffer: () => Promise.resolve(PNG.buffer),
      }),
    )

    expect(await service.ingestFromUrl(1, 'https://img.clerk.com/x')).toBe(null)
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    expect(await service.ingestFromUrl(1, 'https://img.clerk.com/x')).toBe(null)
  })
})
