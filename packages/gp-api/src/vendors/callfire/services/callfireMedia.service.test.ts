import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'
import { CallfireMediaService } from './callfireMedia.service'

const axiosError = (status: number): AxiosError => {
  const config = { url: '/x', headers: new AxiosHeaders() }
  const response = {
    data: { message: 'boom' },
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

describe('CallfireMediaService', () => {
  let service: CallfireMediaService
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() }
    service = new CallfireMediaService(
      createMockLogger(),
      http as unknown as CallfireHttpService,
      new CallfireErrorHandlingService(),
    )
  })

  const params = {
    file: Buffer.from('audio-bytes'),
    fileName: 'clip.mp3',
    mimeType: 'audio/mpeg',
  }

  it('uploads audio and returns the sound id as a string', async () => {
    // Kept as a string: CallFire's int64 id exceeds JS's safe-integer range.
    http.post.mockResolvedValue({
      id: '3971671023417296254',
      name: 'clip',
      status: 'ACTIVE',
    })

    const result = await service.uploadSound(params)

    expect(http.post).toHaveBeenCalledWith(
      '/campaigns/sounds/files',
      expect.anything(),
      expect.anything(),
    )
    expect(result.mediaId).toBe('3971671023417296254')
  })

  it('rejects an unsupported mime type before calling the API', async () => {
    await expect(
      service.uploadSound({ ...params, mimeType: 'audio/flac' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(http.post).not.toHaveBeenCalled()
  })

  it('maps a CallFire failure to a 502', async () => {
    http.post.mockRejectedValue(axiosError(500))

    await expect(service.uploadSound(params)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
