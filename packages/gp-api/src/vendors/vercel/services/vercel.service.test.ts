import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SDKError } from '@vercel/sdk/models/sdkerror'
import { VercelError } from '@vercel/sdk/models/vercelerror'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VercelService } from './vercel.service'

const { getDomainAuthCode } = vi.hoisted(() => ({
  getDomainAuthCode: vi.fn(),
}))

vi.mock('@vercel/sdk', () => ({
  Vercel: class {
    domainsRegistrar = { getDomainAuthCode }
  },
}))

describe('VercelService.getDomainAuthCode', () => {
  let service: VercelService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new VercelService({
      setContext: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLogger)
  })

  it('returns the auth code Vercel issued', async () => {
    getDomainAuthCode.mockResolvedValue({ authCode: 'AuthC0de!' })

    await expect(service.getDomainAuthCode('test-domain.com')).resolves.toBe(
      'AuthC0de!',
    )
  })

  it.each([
    ['absent', {}],
    ['null', { authCode: null }],
    ['empty', { authCode: '' }],
  ])(
    'rejects rather than returning an empty code when authCode is %s',
    async (_label, responseBody) => {
      // The SDK's inbound schema coerces null/undefined to '' and still types
      // it as string. Passing that through would hand support a credential
      // that only fails later, at the candidate's new registrar, with nothing
      // on our side indicating the request went wrong.
      getDomainAuthCode.mockResolvedValue(responseBody)

      await expect(
        service.getDomainAuthCode('test-domain.com'),
      ).rejects.toBeInstanceOf(BadGatewayException)
    },
  )
})

describe('VercelService when not configured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('logs once on construction and throws on every public method', async () => {
    vi.stubEnv('VERCEL_TOKEN', '')
    vi.stubEnv('VERCEL_PROJECT_ID', '')
    vi.resetModules()
    const { VercelService: VS } = await import('./vercel.service.js')
    const logger = createMockLogger()

    const service = new VS(logger)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Candidate domains are disabled'),
    )
    await expect(
      service.getProjectDomain('test-domain.com'),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.listDomains()).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})

describe('VercelService.isVercelTransientError', () => {
  const service = new VercelService({
    setContext: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger)
  const httpMeta = (status: number) => ({
    response: new Response('', { status }),
    request: new Request('https://api.vercel.com/'),
    body: '',
  })

  it.each([500, 502, 429])('is true for VercelError %i', (status) => {
    expect(
      service.isVercelTransientError(new VercelError('x', httpMeta(status))),
    ).toBe(true)
  })

  it.each([500, 502, 429])('is true for SDKError %i', (status) => {
    expect(
      service.isVercelTransientError(new SDKError('x', httpMeta(status))),
    ).toBe(true)
  })

  it.each([400, 404])('is false for VercelError %i', (status) => {
    expect(
      service.isVercelTransientError(new VercelError('x', httpMeta(status))),
    ).toBe(false)
  })

  it('is false for a plain Error', () => {
    expect(service.isVercelTransientError(new Error('502'))).toBe(false)
  })
})
