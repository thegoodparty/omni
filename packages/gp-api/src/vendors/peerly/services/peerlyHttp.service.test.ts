import { HttpService } from '@nestjs/axios'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { AxiosError } from 'axios'
import { addDays, getUnixTime } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { defer, of, throwError } from 'rxjs'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerlyHttpService } from './peerlyHttp.service'

describe('PeerlyHttpService retries', () => {
  let peerlyHttp: PeerlyHttpService
  let attempts: number
  const mockHttp = { request: vi.fn(), post: vi.fn() }

  beforeEach(async () => {
    attempts = 0
    mockHttp.post.mockReturnValue(
      of({ data: { token: 'test-token', user: {}, root_accounts: [] } }),
    )
    // defer re-runs on every resubscribe, which is what an rxjs retry does,
    // so it counts attempts rather than calls to request().
    mockHttp.request.mockReturnValue(
      defer(() => {
        attempts += 1
        return throwError(
          () => new AxiosError('timeout exceeded', AxiosError.ECONNABORTED),
        )
      }),
    )

    const module = await Test.createTestingModule({
      providers: [
        PeerlyHttpService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: HttpService, useValue: mockHttp },
        {
          provide: JwtService,
          useValue: {
            decode: () => ({ exp: getUnixTime(addDays(new Date(), 1)) }),
          },
        },
      ],
    }).compile()
    peerlyHttp = module.get(PeerlyHttpService)
  })

  it('retries a timed-out call by default', async () => {
    await expect(peerlyHttp.get('/slow')).rejects.toBeInstanceOf(AxiosError)
    expect(attempts).toBe(4)
  })

  it('makes exactly one attempt when the caller turns retries off', async () => {
    await expect(
      peerlyHttp.get('/slow', { timeout: 180000 }, { retry: false }),
    ).rejects.toBeInstanceOf(AxiosError)
    expect(attempts).toBe(1)
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 180000 }),
    )
  })
})
