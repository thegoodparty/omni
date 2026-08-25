import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'
import { CallhubMediaService } from './callhubMedia.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { error_message: 'boom' },
    status,
    statusText: 'err',
    headers: {},
    config: config as AxiosResponse['config'],
  } as AxiosResponse
  return new AxiosError(
    'failed',
    'ERR',
    config as AxiosError['config'],
    {},
    response,
  )
}

describe('CallhubMediaService', () => {
  let service: CallhubMediaService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallhubMediaService(
      createMockLogger(),
      http as unknown as CallhubHttpService,
      new CallhubErrorHandlingService(),
    )
  })

  const params = {
    file: Buffer.from('audio-bytes'),
    fileName: 'clip.mp3',
    mimeType: 'audio/mpeg',
  }

  it('uploads audio and unwraps the data-enveloped id + url', async () => {
    http.post.mockResolvedValue({
      data: { media_file_id: '42', media_url: 'https://x' },
    })

    const result = await service.uploadMedia(params)

    expect(http.post).toHaveBeenCalledWith(
      '/v1/media/upload/',
      expect.anything(),
      expect.anything(),
    )
    expect(result.media_file_id).toBe('42')
    expect(result.media_url).toBe('https://x')
  })

  it('rejects an unsupported mime type before calling the API', async () => {
    await expect(
      service.uploadMedia({ ...params, mimeType: 'audio/flac' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(http.post).not.toHaveBeenCalled()
  })

  it('maps a CallHub failure to a 502', async () => {
    http.post.mockRejectedValue(axiosError(500))

    await expect(service.uploadMedia(params)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
