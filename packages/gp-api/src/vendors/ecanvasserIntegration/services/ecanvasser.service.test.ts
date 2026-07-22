import { HttpService } from '@nestjs/axios'
import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import { AxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ECANVASSER_REQUEST_TIMEOUT_MS,
  EcanvasserService,
} from './ecanvasser.service'

describe('EcanvasserService HTTP timeout + error handling', () => {
  let httpService: {
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
  }
  let service: EcanvasserService

  beforeEach(() => {
    httpService = { get: vi.fn(), post: vi.fn() }
    const logger = {
      setContext: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger
    service = new EcanvasserService(
      httpService as unknown as HttpService,
      logger,
    )
  })

  it('passes an explicit request timeout to the underlying HTTP call', async () => {
    httpService.get.mockReturnValue(
      of({ data: { data: [], meta: { links: {}, ids: {} } } }),
    )

    await service.findTeams('api-key')

    expect(httpService.get).toHaveBeenCalledTimes(1)
    const [, config] = httpService.get.mock.calls[0] ?? []
    expect(config.timeout).toBe(ECANVASSER_REQUEST_TIMEOUT_MS)
    expect(config.headers.Authorization).toBe('Bearer api-key')
  })

  it('throws GatewayTimeoutException when the request times out', async () => {
    const timeoutError = new AxiosError(
      'timeout of 30000ms exceeded',
      'ECONNABORTED',
    )
    httpService.get.mockReturnValue(throwError(() => timeoutError))

    await expect(service.findTeams('api-key')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    )
  })

  it('throws GatewayTimeoutException on a TCP-level ETIMEDOUT', async () => {
    const etimedoutError = new AxiosError('connect ETIMEDOUT', 'ETIMEDOUT')
    httpService.get.mockReturnValue(throwError(() => etimedoutError))

    await expect(service.findTeams('api-key')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    )
  })

  it('throws BadGatewayException for non-timeout failures', async () => {
    httpService.get.mockReturnValue(
      throwError(() => new AxiosError('boom', 'ERR_BAD_RESPONSE')),
    )

    await expect(service.findTeams('api-key')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  // createSurvey is the one method that wraps fetchFromApi in its own catch, so
  // it needs dedicated coverage to prove it re-throws the distinct timeout error
  // (and still wraps everything else as a bad gateway).
  describe('createSurvey', () => {
    it('re-throws GatewayTimeoutException when the POST times out', async () => {
      httpService.post.mockReturnValue(
        throwError(
          () => new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'),
        ),
      )

      await expect(
        service.createSurvey('api-key', { name: 'test' } as never),
      ).rejects.toBeInstanceOf(GatewayTimeoutException)
    })

    it('throws BadGatewayException for non-timeout POST failures', async () => {
      httpService.post.mockReturnValue(
        throwError(() => new AxiosError('boom', 'ERR_BAD_RESPONSE')),
      )

      await expect(
        service.createSurvey('api-key', { name: 'test' } as never),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })
})
