import { BadGatewayException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
