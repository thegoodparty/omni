import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { VERCEL_PURCHASE_TIMEOUT_MS, VercelService } from './vercel.service'

const { getDomainAuthCode, buySingleDomain } = vi.hoisted(() => ({
  getDomainAuthCode: vi.fn(),
  buySingleDomain: vi.fn(),
}))

vi.mock('@vercel/sdk', () => ({
  Vercel: class {
    domainsRegistrar = { getDomainAuthCode, buySingleDomain }
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

describe('VercelService.purchaseDomain', () => {
  it('bounds the registrar buy so it fails before the gateway timeout', async () => {
    buySingleDomain.mockResolvedValue({ orderId: 'order-1' })
    const service = new VercelService({
      setContext: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as PinoLogger)

    await service.purchaseDomain(
      'example.com',
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.co',
        phoneNumber: '3126851162',
        addressLine1: '1 Main St',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60601',
      },
      3.99,
    )

    expect(buySingleDomain).toHaveBeenCalledWith(expect.anything(), {
      timeoutMs: VERCEL_PURCHASE_TIMEOUT_MS,
    })
    expect(VERCEL_PURCHASE_TIMEOUT_MS).toBeLessThan(120_000)
  })
})
