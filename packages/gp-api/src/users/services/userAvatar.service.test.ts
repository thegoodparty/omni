import { HttpStatus } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { MimeTypes } from 'http-constants-ts'
import { LoggerModule } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { UserAvatarService } from './userAvatar.service'

const PNG = new Uint8Array([137, 80, 78, 71])

const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })

// A stream that hands out one chunk per pull and records how many were taken,
// so a test can assert the reader stopped early instead of draining the body.
const countingBody = (chunkCount: number, chunkBytes: number) => {
  const counter = { pulled: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (counter.pulled >= chunkCount) {
        controller.close()
        return
      }
      counter.pulled += 1
      controller.enqueue(new Uint8Array(chunkBytes))
    },
  })
  return { body, counter }
}

// Mirrors a real Response, where arrayBuffer() drains the same underlying
// body, so a test exercises whichever of the two the implementation picks.
const drainToArrayBuffer = async (body: ReadableStream<Uint8Array>) => {
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return Buffer.concat(parts).buffer
}

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
        body: streamOf(PNG),
        arrayBuffer: () => Promise.resolve(PNG.buffer),
      }),
    )

    const url = await service.ingestFromUrl(1, 'https://img.clerk.com/x')

    expect(url).toBe('https://assets.test/uploads/1/a.png')
    expect(uploadFile).toHaveBeenCalledOnce()
    expect(uploadFile.mock.calls[0]?.[1]).toEqual(Buffer.from(PNG))
  })

  it('accepts a content-type with a space before the parameter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        // Headers normalization trims the whole value, not around internal
        // delimiters, so this reaches us with the space intact.
        headers: new Headers({
          'content-type': 'image/jpeg ;charset=utf-8',
          'content-length': '4',
        }),
        body: streamOf(PNG),
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

  it('stops reading an oversized body that declares no content-length', async () => {
    const oneMb = 1024 * 1024
    const { body, counter } = countingBody(100, oneMb)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': MimeTypes.IMAGE_PNG }),
        body,
        arrayBuffer: () => drainToArrayBuffer(body),
      }),
    )

    expect(await service.ingestFromUrl(1, 'https://img.clerk.com/x')).toBe(null)
    expect(uploadFile).not.toHaveBeenCalled()
    // The cap is 5MB, so the read aborts ~6 chunks in and must never
    // materialize the full 100MB. The slack is for ReadableStream's own
    // queue, which fills ahead of the reader by a chunk or two depending on
    // event-loop timing; the exact count is not the point, the bound is.
    expect(counter.pulled).toBeLessThan(10)
  })

  it('returns null when the response has no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': MimeTypes.IMAGE_PNG }),
        body: null,
      }),
    )

    expect(await service.ingestFromUrl(1, 'https://img.clerk.com/x')).toBe(null)
    expect(uploadFile).not.toHaveBeenCalled()
  })
})
